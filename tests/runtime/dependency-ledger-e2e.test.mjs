// End-to-end contract: raw Comm envelopes are transport only. The typed
// lifecycle_update API is the sole writer of dependency state.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CommController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs";
import { connectComm } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-client.mjs";

const NAMESPACE = "crew-run-e2e";
const qualified = (handle) => `${NAMESPACE}-${handle}`;
const members = [
  { handle: "developer-alpha-00", dependsOn: [], task: "Root A." },
  { handle: "developer-beta-00", dependsOn: [], task: "Root B." },
  { handle: "developer-gamma-00", dependsOn: ["developer-alpha-00"], task: "After A." },
  { handle: "developer-delta-00", dependsOn: ["developer-beta-00"], task: "After B." },
];

async function harness() {
  const comm = new CommController();
  for (const member of members) comm.registerActor(qualified(member.handle));
  comm.registerActor(qualified("lead-00"));
  comm.registerPlan(NAMESPACE, members);
  const port = await comm.start();
  const clients = {};
  for (const member of members)
    clients[member.handle] = await connectComm({
      url: `ws://127.0.0.1:${port}`,
      actorId: qualified(member.handle),
      namespace: NAMESPACE,
    });
  return {
    comm,
    clients,
    async close() {
      for (const client of Object.values(clients)) client.close();
      await comm.stop();
    },
  };
}

async function state(comm) {
  return comm.stateSnapshot(qualified("lead-00"), NAMESPACE).nodes.reduce((result, node) => {
    result[node.handle] = node.status;
    return result;
  }, {});
}

test("raw kickoff/report envelopes never advance typed lifecycle state", async () => {
  const { comm, clients, close } = await harness();
  try {
    comm.emit(qualified("lead-00"), qualified("developer-alpha-00"), { kind: "kickoff" });
    await clients["developer-alpha-00"].emit({ to: "main", payload: { kind: "report", taskStatus: "complete" } });
    assert.deepEqual(await state(comm), Object.fromEntries(members.map(({ handle }) => [handle, "waiting"])));
  } finally {
    await close();
  }
});

test("typed lifecycle updates transition nodes and release dependents", async () => {
  const { comm, clients, close } = await harness();
  try {
    await clients["developer-alpha-00"].lifecycleUpdate(NAMESPACE, "running");
    assert.equal((await state(comm))["developer-gamma-00"], "waiting");
    await clients["developer-alpha-00"].lifecycleUpdate(NAMESPACE, "complete");
    assert.equal((await state(comm))["developer-gamma-00"], "ready");
    await clients["developer-gamma-00"].lifecycleUpdate(NAMESPACE, "running");
    await clients["developer-gamma-00"].lifecycleUpdate(NAMESPACE, "complete");
    assert.equal((await state(comm))["developer-gamma-00"], "complete");
  } finally {
    await close();
  }
});

test("typed blocked state propagates only through its dependency chain", async () => {
  const { comm, clients, close } = await harness();
  try {
    await clients["developer-alpha-00"].lifecycleUpdate(NAMESPACE, "running");
    await clients["developer-beta-00"].lifecycleUpdate(NAMESPACE, "running");
    await clients["developer-beta-00"].lifecycleUpdate(NAMESPACE, "blocked");
    const current = await state(comm);
    assert.equal(current["developer-delta-00"], "blocked");
    assert.equal(current["developer-gamma-00"], "waiting");
    assert.equal(current["developer-alpha-00"], "running");
  } finally {
    await close();
  }
});
