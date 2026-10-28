import { strict as assert } from "node:assert";
import test from "node:test";
import { Runtime } from "../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs";
import { connectComm } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-client.mjs";
import { createDependentRelease } from "../../.pi/extensions/hall-crew/crew-runtime/lib/dependent-release.mjs";

const members = [
  { handle: "developer-a-00", dependsOn: [], task: "A" },
  { handle: "developer-b-00", dependsOn: ["developer-a-00"], task: "B" },
  { handle: "developer-c-00", dependsOn: ["developer-a-00", "developer-b-00"], task: "C" },
];

test("only ready dependents are sent, each exactly once, and roots are never re-sent", async () => {
  const sent = [];
  const release = createDependentRelease({ members, released: ["developer-a-00"], send: async (m) => sent.push(m.handle) });
  assert.deepEqual(release.held(), ["developer-b-00", "developer-c-00"]);
  await release.observe([{ handle: "developer-a-00", status: "ready" }, { handle: "developer-b-00", status: "waiting" }]);
  assert.deepEqual(sent, []);
  const nodes = [{ handle: "developer-b-00", status: "ready" }];
  await Promise.all([release.observe(nodes), release.observe(nodes)]);
  await release.observe(nodes);
  assert.deepEqual(sent, ["developer-b-00"]);
  assert.deepEqual(release.held(), ["developer-c-00"]);
});

test("a failed send is reported and never retried into a duplicate", async () => {
  const errors = [];
  let calls = 0;
  const release = createDependentRelease({
    members,
    released: ["developer-a-00"],
    send: async () => ((calls += 1), Promise.reject(new Error("gone"))),
    onError: (member, error) => errors.push([member.handle, error.message]),
  });
  const nodes = [{ handle: "developer-b-00", status: "ready" }];
  await release.observe(nodes);
  await release.observe(nodes);
  assert.equal(calls, 1);
  assert.deepEqual(errors, [["developer-b-00", "gone"]]);
});

const runId = "33333333-3333-3333-3333-333333333333";
const namespace = `crew-${runId}`;
const id = (handle) => `${namespace}-${handle}`;

async function crew(t) {
  const runtime = new Runtime(process.cwd());
  const plan = { namespace, members };
  const comm = await runtime.startComm(members.map((m) => id(m.handle)), [], plan);
  const workers = {};
  const received = {};
  for (const { handle } of members) {
    received[handle] = [];
    workers[handle] = await connectComm({ ...comm, actorId: id(handle), namespace });
    workers[handle].onDelivery((message) => {
      received[handle].push(message);
      workers[handle].acknowledge(message.id);
    });
  }
  t.after(async () => {
    Object.values(workers).forEach((worker) => worker.close());
    await runtime.stop();
  });
  return { runtime, workers, received };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test("a dependent receives its task when its prerequisites complete, in order (leadless)", async (t) => {
  const { runtime, workers, received } = await crew(t);
  const result = await runtime.dispatchRoots(runId, "k1");
  assert.deepEqual(result.held, ["developer-b-00", "developer-c-00"]);
  await settle();
  assert.deepEqual(received["developer-a-00"].map((m) => m.payload.task), ["A"]);
  assert.deepEqual([received["developer-b-00"].length, received["developer-c-00"].length], [0, 0]);

  await workers["developer-a-00"].lifecycleUpdate(namespace, "running");
  await workers["developer-a-00"].lifecycleUpdate(namespace, "complete");
  await settle();
  assert.deepEqual(received["developer-b-00"].map((m) => m.payload.task), ["B"]);
  assert.deepEqual(received["developer-b-00"][0].payload.prerequisites, ["developer-a-00"]);
  assert.equal(received["developer-c-00"].length, 0, "the integrator waits for every prerequisite");

  await workers["developer-b-00"].lifecycleUpdate(namespace, "running");
  await workers["developer-b-00"].lifecycleUpdate(namespace, "complete");
  await settle();
  assert.deepEqual(received["developer-c-00"].map((m) => m.payload.task), ["C"]);
  assert.deepEqual(received["developer-b-00"].length, 1, "released exactly once");
});

test("a failed prerequisite blocks its dependents instead of releasing them", async (t) => {
  const { runtime, workers, received } = await crew(t);
  await runtime.dispatchRoots(runId, "k2");
  await workers["developer-a-00"].lifecycleUpdate(namespace, "running");
  await workers["developer-a-00"].lifecycleUpdate(namespace, "failed");
  await settle();
  assert.deepEqual([received["developer-b-00"].length, received["developer-c-00"].length], [0, 0]);
  const snapshot = await workers["developer-a-00"].getStateSnapshot(namespace);
  const status = Object.fromEntries(snapshot.nodes.map((node) => [node.handle, node.status]));
  assert.deepEqual(status, { "developer-a-00": "failed", "developer-b-00": "blocked", "developer-c-00": "blocked" });
});

test("a prerequisite that finished before the subscription still releases its dependent", async (t) => {
  const { runtime, workers, received } = await crew(t);
  await workers["developer-a-00"].lifecycleUpdate(namespace, "running");
  await workers["developer-a-00"].lifecycleUpdate(namespace, "complete");
  await runtime.dispatchRoots(runId, "k3");
  await settle();
  assert.deepEqual(received["developer-b-00"].map((m) => m.payload.task), ["B"]);
});
