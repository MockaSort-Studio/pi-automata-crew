import { strict as assert } from "node:assert";
import test from "node:test";
import { createEnvironment } from "../../extensions/crew/runner/environment.mjs";
import { createTrackedVm } from "../../extensions/crew/env-runtime/lib/vm-lifecycle.mjs";
import { githubCiHeadersAllowed, githubCiRequestAllowed } from "../../extensions/crew/runner/github-ci-network.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

// The proxy resolves api.github.com normally, but this fake upstream never delegates HTTP.
test("guest proxy confines CI metadata and revokes placeholders on VM release", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const token = "dummy-ci-secret-never-networked";
  const requests = [];
  const logs = [];
  const boots = [];
  const fetch = async (url, options) => {
    requests.push({ url, authorization: options.headers.authorization });
    const page = new URL(url).searchParams.get("page");
    if (page === "2")
      return new Response(null, { status: 302, headers: { location: "/repos/Owner/Repo/actions/runs?page=1" } });
    if (page === "3") return new Response(null, { status: 302, headers: { location: "https://evil.example/leak" } });
    return new Response("metadata-ok", { status: 200 });
  };
  const environment = createEnvironment({
    localCwd: "/unused",
    allowedHosts: ["api.github.com"],
    secrets: { GH_TOKEN: { value: token, hosts: ["api.github.com"] } },
    onRequest: (request, env) =>
      githubCiHeadersAllowed(request.headers, env.GH_TOKEN) &&
      githubCiRequestAllowed(request, { repo: "Owner/Repo", operations: ["github_workflow_runs_list"] })
        ? undefined
        : new Response("blocked", { status: 403 }),
    seed: (workspace) => workspace.writeFile("/seed.txt", "seed-evidence"),
    createVm: async (options) => {
      boots.push({ placeholder: options.env.GH_TOKEN, hooks: options.httpHooks });
      return createTrackedVm({
        ...options,
        debugLog: (...args) => logs.push(args),
        sandbox: { ...options.sandbox, debug: ["net"], fetch },
      });
    },
  });
  t.after(() => environment.close());
  const run = (command) => environment.withVm((vm) => vm.exec(command));
  const curl = (path, auth = "$GH_TOKEN") =>
    `curl -skS -m 15 -w ' status=%{http_code}' -H "Authorization: Bearer ${auth}" 'https://api.github.com${path}'`;
  const first = await run(
    `${curl("/repos/Owner/Repo/actions/runs?page=1")}; printf '\\n'; printf '%s' "$GH_TOKEN"; printf '\\n'; cat /workspace/seed.txt`,
  );
  assert.equal(first.exitCode, 0, first.stderr);
  assert.match(first.stdout, /metadata-ok status=200/);
  assert.ok(first.stdout.includes(boots[0].placeholder));
  assert.ok(!first.stdout.includes(token));
  assert.equal(requests[0].authorization, `Bearer ${token}`);
  for (const page of [2, 3]) {
    const before = requests.length;
    const result = await run(curl(`/repos/Owner/Repo/actions/runs?page=${page}`));
    assert.match(result.stdout, /status=403/);
    assert.equal(requests.length, before + 1);
    assert.ok(!result.stdout.includes(token));
  }
  for (const path of [
    "/repos/Other/Repo/actions/runs",
    "/repos/Owner/Repo/actions/runs/1/logs",
    "/repos/Owner/Repo/actions/runs/1",
  ]) {
    const before = requests.length;
    assert.match((await run(curl(path))).stdout, /status=403/);
    assert.equal(requests.length, before);
  }
  await environment.release();
  const old = boots[0].placeholder;
  const revoked = await boots[0].hooks.onRequest(
    new Request("https://api.github.com/repos/Owner/Repo/actions/runs", {
      headers: { authorization: `Bearer ${old}` },
    }),
  );
  assert.notEqual(revoked.headers.get("authorization"), `Bearer ${token}`);
  const reboot = await run(
    `printf '%s\\n' "$GH_TOKEN"; ${curl("/repos/Owner/Repo/actions/runs?page=1")}; printf '\\n'; ${curl("/repos/Owner/Repo/actions/runs", old)}; printf '\\n'; cat /workspace/seed.txt`,
  );
  assert.notEqual(boots[1].placeholder, old);
  assert.match(reboot.stdout, /metadata-ok status=200/);
  assert.match(reboot.stdout, /status=403/);
  assert.ok(!reboot.stdout.includes(token));
  assert.equal(String(await environment.workspace.readFile("/seed.txt")), "seed-evidence");
  assert.ok(!JSON.stringify({ first, reboot, logs }).includes(token));
});
