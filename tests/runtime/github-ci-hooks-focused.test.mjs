import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestNetwork } from "../../extensions/crew/env-runtime/lib/guest-network.mjs";
import { githubCiHeadersAllowed, githubCiRequestAllowed } from "../../extensions/crew/runner/github-ci-network.mjs";

test("Gondolin substitutes only after scoped validation and revocation prevents reuse", async () => {
  const token = "host-only-test-token";
  let placeholder;
  const network = createGuestNetwork({
    allowedHosts: ["api.github.com"],
    secrets: { GH_TOKEN: { value: token, hosts: ["api.github.com"] } },
    onRequest: (request) => githubCiHeadersAllowed(request.headers, placeholder) && githubCiRequestAllowed(request, { repo: "Owner/Repo", operations: ["github_workflow_runs_list"] }) ? undefined : new Response("blocked", { status: 403 }),
  });
  placeholder = network.env.GH_TOKEN;
  assert.notEqual(placeholder, token);
  assert.ok(!JSON.stringify(network.env).includes(token));
  const request = () => new Request("https://api.github.com/repos/Owner/Repo/actions/runs", { headers: { authorization: `Bearer ${placeholder}` } });
  const sent = await network.httpHooks.onRequest(request());
  assert.equal(sent.headers.get("authorization"), `Bearer ${token}`);
  assert.equal((await network.httpHooks.onRequest(sent)).status, 403);
  assert.equal(await network.httpHooks.isIpAllowed({ hostname: "api.github.com", ip: "127.0.0.1", family: 4, port: 443, protocol: "https" }), false);
  assert.equal(await network.httpHooks.isIpAllowed({ hostname: "evil.example", ip: "8.8.8.8", family: 4, port: 443, protocol: "https" }), false);
  network.secretManager.deleteSecret("GH_TOKEN");
  assert.notEqual((await network.httpHooks.onRequest(request())).headers.get("authorization"), `Bearer ${token}`);
});
