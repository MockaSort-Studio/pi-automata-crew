import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// A member kept busy for a long time: not `sleep`, which the worker shell policy rejects as polling.
import { createHostClient } from "../../extensions/crew/runner/host-client.mjs";
import { listProcesses, vmmChildrenOf } from "../../extensions/crew/env-runtime/lib/vm-processes.mjs";
import { mockModel } from "./mock-model.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

const fixtures = new URL("./fixtures/", import.meta.url).pathname;
const A = "developer-alpha-00";
const B = "developer-bravo-00";
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
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function world(t, respond) {
  const server = mockModel(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "crew-host-"));
  const env = {
    ...process.env,
    CREW_HOST_DEPS: join(fixtures, "host-deps.mjs"),
    CREW_TEST_MOCK_URL: `http://127.0.0.1:${server.address().port}/v1`,
  };
  const events = [];
  const client = createHostClient({ env, cwd: process.cwd(), onEvent: (event) => events.push(event) });
  t.after(async () => {
    await client.stop();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { server, dir, env, client, events };
}
const results = (events) => events.filter((e) => e.event === "result").map((e) => [e.handle, e.result.status]);
const mentions = (body, marker) => body.includes(marker);

test("host protocol cancels a member stuck in CI", { timeout: 9000 }, async (t) => {
  const host = spawn(process.execPath, ["extensions/crew/runner/host-main.mjs"], {
    env: { ...process.env, CREW_HOST_DEPS: join(fixtures, "host-stuck-deps.mjs") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => host.kill("SIGKILL"));
  let output = "";
  host.stdout.on("data", (data) => (output += data));
  host.stdin.write(`${JSON.stringify({ id: 1, method: "launch", params: { runId: "stuck", members: [member(A, { model: undefined })] } })}\n`);
  assert.ok(await waitUntil(() => output.includes('"state":"ci"'), 3000));
  host.stdin.write(`${JSON.stringify({ id: 2, method: "cancel", params: { runId: "stuck", handle: A } })}\n`);
  assert.ok(await waitUntil(() => output.includes('"id":2,"ok":true'), 7000));
  assert.ok(output.includes('"state":"cancelled"'));
});

for (const trigger of ["SIGTERM", "stdin"]) {
  test(`host exits on ${trigger} with stuck CI and disposal`, { timeout: 14000 }, async (t) => {
    const host = spawn(process.execPath, ["extensions/crew/runner/host-main.mjs"], {
      env: { ...process.env, CREW_HOST_DEPS: join(fixtures, "host-stuck-deps.mjs") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    t.after(() => host.kill("SIGKILL"));
    let output = "";
    host.stdout.on("data", (data) => (output += data));
    const exited = new Promise((resolve) => host.once("exit", resolve));
    host.stdin.write(`${JSON.stringify({ id: 1, method: "launch", params: { runId: "stuck", members: [member(A, { model: undefined })] } })}\n`);
    assert.ok(await waitUntil(() => output.includes('"state":"ci"'), 3000));
    if (trigger === "stdin") host.stdin.end();
    else host.kill(trigger);
    assert.equal(await exited, 0);
  });
}

test(
  "a crew runs in a real host process: ordering, hand-over, a question and its answer",
  { timeout: 240_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    let asked = false;
    const { server, dir, client, events } = await world(t, (n, body) => {
      const tool = body.includes('"role":"tool"');
      if (mentions(body, "DEVELOPER-ALPHA-00") && !tool && !asked && !body.includes("src/main.mjs"))
        return (asked = true), call("request_input", { question: "Which file?" });
      if (mentions(body, "DEVELOPER-ALPHA-00")) return { text: "alpha used src/main.mjs" };
      if (mentions(body, "DEVELOPER-BRAVO-00")) return { text: "bravo done" };
      return { text: "?" };
    });
    const launched = await client.request("launch", {
      runId: "run1",
      crewDir: dir,
      members: [member(A), member(B, { dependsOn: [A] })],
    });
    assert.deepEqual(
      launched.members.map((m) => m.handle),
      [A, B],
    );
    assert.ok(await waitUntil(() => results(events).some(([h]) => h === A), 60_000), "alpha reported");
    assert.deepEqual(results(events), [[A, "needs_input"]]);
    const question = events.find((e) => e.event === "result").result.question;
    assert.equal(question, "Which file?");
    assert.deepEqual(
      (await client.request("status", { runId: "run1" })).members.map((m) => m.state),
      ["needs_input", "held"],
    );

    await client.request("message", { runId: "run1", handle: A, text: "src/main.mjs" });
    assert.ok(await waitUntil(() => results(events).length >= 3, 60_000), "alpha and then bravo completed");
    assert.deepEqual(results(events), [
      [A, "needs_input"],
      [A, "completed"],
      [B, "completed"],
    ]);
    const bravoPrompt = server.requests.find((body) => body.includes("Task for developer-bravo-00."));
    assert.match(bravoPrompt, /alpha used src\/main\.mjs/, "bravo was handed alpha's result");
    assert.match(JSON.stringify(events.filter((e) => e.event === "result" && e.handle === B)), /bravo done/);
    await client.request("dispose", { runId: "run1" });
  },
);

test("launch validation fails before any VM, and the host stays usable", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const { client, dir } = await world(t, () => ({ text: "ok" }));
  await assert.rejects(
    client.request("launch", { runId: "bad", crewDir: dir, members: [member(A, { model: "mock/nope" })] }),
    /developer-alpha-00: Model "mock\/nope" was not found/,
  );
  await assert.rejects(
    client.request("launch", { runId: "bad", crewDir: dir, members: [member(A, { dependsOn: [B] })] }),
    /Unknown dependency/,
  );
  assert.equal(vmmChildrenOf(client.pid, listProcesses()).length, 0, "no VM was started");
  const ok = await client.request("launch", { runId: "good", crewDir: dir, members: [member(A)] });
  assert.equal(ok.runId, "good");
});

test("killing Main with SIGKILL closes the host and every VM", { timeout: 240_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const { server, dir, env } = await world(t, () =>
    call("bash", { command: "echo started; node -e 'setInterval(() => {}, 1000)'" }),
  );
  const owner = spawn(process.execPath, [join(fixtures, "host-owner.mjs")], {
    env: { ...env, CREW_TEST_LAUNCH: JSON.stringify({ runId: "run1", crewDir: dir, members: [member(A)] }) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  owner.stdout.on("data", (chunk) => (output += chunk));
  t.after(() => owner.kill("SIGKILL"));
  assert.ok(await waitUntil(() => /LAUNCHED \d+/.test(output), 60_000), "the owner launched a crew");
  const hostPid = Number(/LAUNCHED (\d+)/.exec(output)[1]);
  assert.ok(
    await waitUntil(() => vmmChildrenOf(hostPid, listProcesses()).length === 1, 60_000),
    "the member's VM is running",
  );
  assert.ok(server.requests.length >= 1);
  const vms = vmmChildrenOf(hostPid, listProcesses());

  owner.kill("SIGKILL");
  assert.ok(await waitUntil(() => !alive(hostPid), 30_000), "the host exits when Main dies");
  const survivors = () => listProcesses().filter((p) => vms.some((vm) => vm.pid === p.pid && vm.start === p.start));
  assert.ok(await waitUntil(() => survivors().length === 0, 15_000), "no VM outlives Main");
});

test("a SIGKILLed host leaves no VM either, and a graceful stop closes everything", { timeout: 240_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const { dir, client } = await world(t, () =>
    call("bash", { command: "echo started; node -e 'setInterval(() => {}, 1000)'" }),
  );
  await client.request("launch", { runId: "run1", crewDir: dir, members: [member(A)] });
  const hostPid = client.pid;
  assert.ok(await waitUntil(() => vmmChildrenOf(hostPid, listProcesses()).length === 1, 60_000));
  const vms = vmmChildrenOf(hostPid, listProcesses());
  process.kill(hostPid, "SIGKILL");
  assert.ok(
    await waitUntil(
      () => !listProcesses().some((p) => vms.some((vm) => vm.pid === p.pid && vm.start === p.start)),
      15_000,
    ),
    "the guardian removed the VM",
  );

  const second = createHostClient({
    env: {
      ...process.env,
      CREW_HOST_DEPS: join(fixtures, "host-deps.mjs"),
      CREW_TEST_MOCK_URL: "http://127.0.0.1:9/v1",
    },
    cwd: process.cwd(),
  });
  await second.request("list");
  const pid = second.pid;
  await second.stop();
  assert.equal(alive(pid), false, "stop closes stdin and the host exits");
});
