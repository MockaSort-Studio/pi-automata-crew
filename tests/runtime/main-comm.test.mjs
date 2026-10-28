import { strict as assert } from "node:assert";
import test from "node:test";
import { Runtime } from "../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs";
import { connectComm } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-client.mjs";

const runId = "11111111-1111-1111-1111-111111111111";
const namespace = `crew-${runId}`;
const handle = "developer-snowball-00";
const actorId = `${namespace}-${handle}`;

async function setup(t) {
  const runtime = new Runtime(process.cwd());
  const comm = await runtime.startComm([actorId], [], { namespace, members: [{ handle, dependsOn: [], task: "" }] });
  const worker = await connectComm({ ...comm, actorId, namespace });
  t.after(async () => {
    worker.close();
    await runtime.stop();
  });
  return { runtime, worker };
}

test("Main sends one handle-resolved message and broadcasts to the run", async (t) => {
  const { runtime, worker } = await setup(t);
  const deliveries = [];
  worker.onDelivery((message) => deliveries.push(message));
  await runtime.sendMember(runId, handle, { kind: "task", value: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(deliveries[0]?.payload, { kind: "task", value: 1 });
  await worker.acknowledge(deliveries[0].id);
  await runtime.broadcastRun(runId, { kind: "notice" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(deliveries[1]?.payload, { kind: "notice" });
});

test("Main receives a request and only its correlated reply acknowledges it", async (t) => {
  const { runtime, worker } = await setup(t);
  const replies = [];
  worker.onDelivery((message) => replies.push(message));
  await worker.emit({ to: "main", payload: { question: "continue?" }, replyRequired: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const request = await runtime.receive();
  assert.equal(request?.replyRequired, true);
  await runtime.replyFromMain(request.id, { answer: "yes" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(replies[0]?.replyTo, request.id);
  assert.deepEqual(replies[0]?.payload, { answer: "yes" });
});

test("readiness barrier resolves after workers report ready and times out otherwise", async () => {
  const { CommController } = await import("../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs");
  const comm = new CommController();
  comm.registerActor("ns-a", { role: "developer" });
  comm.registerPlan("ns", [{ handle: "developer-a-00", dependsOn: [], task: "" }]);
  await assert.rejects(comm.waitReady("ns", ["ns-a"], 20), /timed out/);
  const pending = comm.waitReady("ns", ["ns-a"], 1000);
  comm.markReady("ns-a", "ns");
  assert.deepEqual(await pending, { ready: ["ns-a"] });
});

test("broker allows broadcast only from a lead", async () => {
  const { CommController } = await import("../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs");
  const comm = new CommController({ broadcastStaggerMs: 0 });
  comm.registerActor("ns-lead", { role: "lead" });
  comm.registerActor("ns-dev", { role: "developer" });
  comm.registerPlan("ns", [
    { handle: "lead-a-00", dependsOn: [], task: "" },
    { handle: "developer-b-00", dependsOn: [], task: "" },
  ]);
  await assert.rejects(comm.broadcast("ns-dev", "ns", {}), /Only the Crew Lead/);
  const sent = await comm.broadcast("ns-lead", "ns", {});
  assert.equal(sent.recipients.length, 1, "a Lead broadcast reaches the other Crew member only, never Main");
});

test("dispatchRoots delivers only root tasks, idempotently and once", async (t) => {
  const { runtime, worker } = await setup(t);
  const got = [];
  worker.onDelivery((m) => got.push(m));
  await assert.rejects(runtime.dispatchRoots("22222222-2222-2222-2222-222222222222", "k"), /Unknown Crew dispatch plan/);
  const first = await runtime.dispatchRoots(runId, "k");
  assert.equal(first.recipients.length, 1);
  assert.deepEqual(await runtime.dispatchRoots(runId, "k"), first);
  await assert.rejects(runtime.dispatchRoots(runId, "other"), /already exists/);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(got.length, 1);
  assert.equal(got[0].payload.kind, "task");
});

test("a launch that never becomes ready removes its workers and stops Comm/Lifecycle", async () => {
  const runtime = new Runtime(process.cwd());
  const name = "developer-snowball-00";
  const id = `rollback-${process.pid}`;
  const plan = { namespace: `crew-${id}`, members: [{ handle: name, dependsOn: [], task: "x" }] };
  await assert.rejects(
    runtime.launchCrew([{ name, actorId: id, task: "x", resident: true }], [], plan, { readyTimeoutMs: 1 }),
    /timed out/,
  );
  await assert.rejects(runtime.inspectComm(), /not running/);
  assert.deepEqual(await runtime.list(), []);
  await runtime.stop();
});

test("Main receives later messages without acknowledging earlier ones", async (t) => {
  const { runtime, worker } = await setup(t);
  await worker.emit({ to: "main", payload: { n: 1 } });
  await worker.emit({ to: "main", payload: { n: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const first = await runtime.receive("main");
  const second = await runtime.receive("main");
  assert.deepEqual([first.payload.n, second.payload.n], [1, 2]);
  assert.deepEqual(await runtime.acknowledgeMain(first.id), { acknowledged: true });
});
