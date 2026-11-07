import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHostClient } from "../../extensions/crew/runner/host-client.mjs";
import { listProcesses, vmmChildrenOf } from "../../extensions/crew/env-runtime/lib/vm-processes.mjs";
import { mockModel } from "./mock-model.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

// The crew host under stress: real host process, real VMs, offline model. Each test is a way a crew goes wrong
// in practice, and asserts what Main would see and that nothing is left behind.
const fixtures = new URL("./fixtures/", import.meta.url).pathname;
const member = (handle, extra = {}) => ({
  handle,
  instructions: `You are ${handle.toUpperCase()}.`,
  task: `Task for ${handle}.`,
  tools: ["bash", "read"],
  suiteGrants: [],
  model: "mock/mock-model",
  dependsOn: [],
  ...extra,
});
const call = (name, args) => ({ toolCall: { name, arguments: JSON.stringify(args) } });
const waitUntil = async (condition, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
};
const whoIs = (body) => /YOU ARE (DEVELOPER-[A-Z]+-\d\d)/i.exec(body)?.[1]?.toLowerCase();
const rssMb = (pids) => {
  if (!pids.length) return 0;
  const out = execFileSync("ps", ["-o", "rss=", "-p", pids.join(",")], { encoding: "utf8" });
  return out.split("\n").reduce((sum, line) => sum + (Number(line.trim()) || 0), 0) / 1024;
};

async function world(t, respond) {
  const server = mockModel(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "crew-battle-"));
  const events = [];
  const client = createHostClient({
    env: {
      ...process.env,
      CREW_HOST_DEPS: join(fixtures, "host-deps.mjs"),
      CREW_TEST_MOCK_URL: `http://127.0.0.1:${server.address().port}/v1`,
    },
    cwd: process.cwd(),
    onEvent: (event) => events.push(event),
  });
  t.after(async () => {
    await client.stop();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const results = (handle) => events.filter((e) => e.event === "result" && e.handle === handle).map((e) => e.result);
  const vms = () => vmmChildrenOf(client.pid, listProcesses());
  const launch = (members, extra = {}) => client.request("launch", { runId: "run1", crewDir: dir, members, ...extra });
  const stateOf = async (handle) =>
    (await client.request("status", { runId: "run1" })).members.find((m) => m.handle === handle)?.state;
  return { server, client, events, results, vms, launch, stateOf };
}
const A = "developer-alpha-00";

test(
  "cancelling a member stuck in a long command ends it promptly and frees its VM",
  { timeout: 240_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const w = await world(t, () => call("bash", { command: "echo begun; sleep 600" }));
    await w.launch([member(A)]);
    assert.ok(await waitUntil(() => w.vms().length === 1 && w.server.requests.length >= 1, 60_000));
    await waitUntil(async () => (await w.stateOf(A)) === "running", 5_000);
    const started = Date.now();
    await w.client.request("cancel", { runId: "run1", handle: A });
    assert.ok(Date.now() - started < 20_000, `cancel took ${Date.now() - started} ms`);
    assert.equal(w.results(A).at(-1).status, "cancelled");
    assert.equal(await w.stateOf(A), "cancelled");
    await w.client.request("dispose", { runId: "run1" });
    assert.ok(await waitUntil(() => w.vms().length === 0, 15_000), "the VM is gone after dispose");
  },
);

test(
  "a rate-limited provider holds the member with a category; a later message resumes it",
  { timeout: 240_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    let limited = true;
    const w = await world(t, () =>
      limited
        ? { status: 429, body: JSON.stringify({ error: { message: "rate limit exceeded", type: "rate_limit" } }) }
        : { text: "recovered and done" },
    );
    await w.launch([member(A)]);
    assert.ok(await waitUntil(() => w.results(A).length === 1, 120_000), "a failure is reported, not silence");
    const [failed] = w.results(A);
    assert.equal(failed.status, "failed");
    assert.equal(failed.failure.category, "rate_limit_or_quota");
    assert.doesNotMatch(JSON.stringify(failed), /rate limit exceeded/, "only the fixed category, not provider text");
    assert.equal(await w.stateOf(A), "failed");
    limited = false;
    await w.client.request("message", { runId: "run1", handle: A, text: "try again" });
    assert.ok(await waitUntil(() => w.results(A).length === 2, 60_000));
    assert.deepEqual([w.results(A)[1].status, w.results(A)[1].finalText], ["completed", "recovered and done"]);
  },
);

test("an empty model turn is a failure, never a silent success", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const w = await world(t, () => ({ empty: true }));
  await w.launch([member(A)]);
  assert.ok(await waitUntil(() => w.results(A).length === 1, 60_000));
  assert.equal(w.results(A)[0].status, "failed");
});

test("a 1 MiB report and 2 MiB of command output pass through intact", { timeout: 240_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const big = `${"0123456789abcdef".repeat(65536)}END`;
  const w = await world(t, (n, body) =>
    body.includes('"role":"tool"')
      ? { text: big }
      : call("bash", { command: "head -c 2097152 /dev/zero | tr '\\0' x; echo; echo tail-marker" }),
  );
  await w.launch([member(A)]);
  assert.ok(await waitUntil(() => w.results(A).length === 1, 120_000));
  const [result] = w.results(A);
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, big, "the whole report crossed the host's pipe");
  const toolMessage = w.server.requests.find((body) => body.includes('"role":"tool"'));
  assert.match(toolMessage, /tail-marker/, "output was truncated from the front, so the end is kept");
  assert.ok(toolMessage.length < 200_000, "what the model sees is bounded");
  // The host is still serving after moving that much data.
  assert.equal((await w.client.request("list")).crews[0], "run1");
});

test(
  "four members at once all finish, and their combined memory and cleanup are measured",
  { timeout: 360_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const handles = ["alpha", "bravo", "charlie", "delta"].map((n) => `developer-${n}-00`);
    const w = await world(t, (n, body) => {
      const who = whoIs(body);
      return body.includes('"role":"tool"')
        ? { text: `${who} finished` }
        : call("bash", { command: "sleep 8; echo ok" });
    });
    await w.launch(handles.map((h) => member(h)));
    assert.ok(await waitUntil(() => w.vms().length === 4, 90_000), "four VMs run side by side");
    const peak = rssMb(w.vms().map((vm) => vm.pid));
    assert.ok(await waitUntil(() => handles.every((h) => w.results(h).length === 1), 180_000));
    for (const h of handles)
      assert.deepEqual([w.results(h)[0].status, w.results(h)[0].finalText], ["completed", `${h} finished`]);
    console.log(`# four concurrent members: peak VM memory ${Math.round(peak)} MB`);
    assert.ok(peak < 3500, `VM memory for four members was ${Math.round(peak)} MB`);
    await w.client.request("dispose", { runId: "run1" });
    assert.ok(await waitUntil(() => w.vms().length === 0, 20_000), "every VM is gone after dispose");
  },
);

test(
  "a crew host that dies mid-run is replaced on the next request, and old VMs are gone",
  { timeout: 240_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const w = await world(t, () => call("bash", { command: "sleep 600" }));
    await w.launch([member(A)]);
    assert.ok(await waitUntil(() => w.vms().length === 1, 60_000));
    const oldVms = w.vms();
    const pid = w.client.pid;
    // A request already in flight when the host dies fails with what the host last said, instead of hanging.
    const inFlight = w.client.request("status", { runId: "run1" });
    process.kill(pid, "SIGKILL");
    await assert.rejects(inFlight, /The crew host exited \(SIGKILL\)/);
    assert.ok(await waitUntil(() => !w.client.running, 5_000));
    // The next request starts a fresh host that knows nothing about the dead one's crews.
    assert.deepEqual((await w.client.request("list")).crews, []);
    assert.notEqual(w.client.pid, pid);
    assert.ok(
      await waitUntil(
        () => !listProcesses().some((p) => oldVms.some((vm) => vm.pid === p.pid && vm.start === p.start)),
        20_000,
      ),
      "the dead host's VM was removed",
    );
  },
);
