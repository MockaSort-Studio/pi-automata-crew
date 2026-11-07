import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { bindCrewHost, crewHost } from "../../extensions/crew/crew/lib/crew-host.mjs";

// The module keeps one holder for the life of the process (that is what survives /reload); each test starts it empty.
beforeEach(() => {
  const holder = globalThis.__piCrewHost;
  if (holder)
    Object.assign(holder, { client: undefined, pi: undefined, notifier: undefined, runs: new Map(), stopping: false });
});

const piRecorder = () => {
  const sent = [];
  return { sent, sendMessage: (message, options) => sent.push({ message, options }) };
};
function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), "crew-host-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const created = [];
  const createClient = (options) => {
    const client = {
      options,
      stopped: false,
      request: async () => ({}),
      stop: async () => {
        client.stopped = true;
      },
    };
    created.push(client);
    return client;
  };
  const pi = piRecorder();
  bindCrewHost(pi);
  return { cwd, created, pi, host: crewHost({ cwd, configDir: ".pi", createClient }) };
}
const result = (status) => ({ status, finalText: "x", usage: {}, evidence: {} });

test("one client per Main, started lazily, logging inside the runtime directory", (t) => {
  const { host, created, cwd } = setup(t);
  assert.equal(created.length, 0);
  assert.equal(host.client(), host.client());
  assert.equal(created.length, 1);
  assert.equal(created[0].options.logFile, join(cwd, ".pi/runtime/crew-host.log"));
});

test("a member's result is delivered to Main as a steering message and appended to the run record", (t) => {
  const { host, created, pi, cwd } = setup(t);
  const dir = join(cwd, ".pi/runtime/crews/run1");
  host.client();
  host.track("run1", dir);
  created[0].options.onEvent({ event: "result", runId: "run1", handle: "developer-a-00", result: result("completed") });
  assert.equal(pi.sent.length, 1);
  assert.deepEqual(pi.sent[0].options, { triggerTurn: true, deliverAs: "steer" });
  assert.match(pi.sent[0].message.content, /developer-a-00 reported: completed/);
  const lines = readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.deepEqual(
    [lines[0].event, lines[0].handle, lines[0].result.status],
    ["result", "developer-a-00", "completed"],
  );
  created[0].options.onEvent({ event: "result", runId: "untracked", handle: "x", result: result("completed") });
  assert.equal(existsSync(join(cwd, ".pi/runtime/crews/untracked")), false, "only tracked runs are recorded");
});

test("when every member has settled Main is told once, and asked for input if someone is waiting", (t) => {
  const { host, created, pi } = setup(t);
  host.client();
  const idle = (ledgers) => ({
    event: "idle",
    runId: "run1",
    members: ledgers.map((ledger, i) => ({ handle: `developer-m${i}-00`, ledger })),
  });
  created[0].options.onEvent(idle(["complete", "running"]));
  assert.equal(pi.sent.length, 0, "not while anyone is still working");
  created[0].options.onEvent(idle(["complete", "blocked"]));
  assert.equal(pi.sent.length, 1);
  assert.match(pi.sent[0].message.content, /waiting for input \(1 complete, 1 blocked\)/);
  created[0].options.onEvent(idle(["complete", "blocked"]));
  assert.equal(pi.sent.length, 1, "no repeat for the same settled state");
});

test("an unexpected host exit is reported and forgets the runs; a requested stop is silent", async (t) => {
  const { host, created, pi } = setup(t);
  host.client();
  host.track("run1", "/d");
  created[0].options.onExit({ code: 1, signal: null, tail: "boom" });
  assert.match(pi.sent[0].message.content, /exited unexpectedly \(code 1\)/);
  assert.deepEqual(host.runs(), []);
  host.client();
  await host.stop();
  assert.equal(created[1].stopped, true);
  created[1].options.onExit({ code: 0, signal: null, tail: "" });
  assert.equal(pi.sent.length, 1, "stopping on purpose is not an incident");
});

test("after a reload the same host keeps running and deliveries go to the current pi", (t) => {
  const { host, created, pi: before } = setup(t);
  host.client();
  const after = piRecorder();
  bindCrewHost(after);
  const reloaded = crewHost({
    cwd: "/elsewhere",
    configDir: ".pi",
    createClient: () => assert.fail("a second host must not start"),
  });
  assert.equal(reloaded.client(), created[0]);
  created[0].options.onEvent({ event: "result", runId: "r", handle: "developer-a-00", result: result("completed") });
  assert.equal(before.sent.length, 0);
  assert.equal(after.sent.length, 1);
});
