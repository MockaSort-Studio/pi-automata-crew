import { strict as assert } from "node:assert";
import test from "node:test";
import { CommController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs";

// A synchronous broadcast delivers every resident worker's first prompt in
// the same tick, which produced a real, reproducible collision: near-
// simultaneous fresh sessions racing the same provider/session-auth path,
// where most came back with a degenerate zero-usage turn. This is a
// scheduling fix -- space activations out -- not a retry: it cannot loop
// and cannot mask a genuine failure, it just stops manufacturing the
// collision.

test("broadcast emits to every recipient in the same tick when staggering is disabled", async () => {
  const comm = new CommController({ broadcastStaggerMs: 0 });
  comm.registerActor("ns-lead");
  comm.registerActor("ns-a");
  comm.registerActor("ns-b");
  comm.registerActor("ns-c");
  comm.registerPlan("ns", []);
  const start = Date.now();
  const result = await comm.broadcast("ns-lead", "ns", { kind: "kickoff" });
  assert.equal(result.recipients.length, 3);
  assert.ok(Date.now() - start < 20);
});

test("broadcast spaces recipient delivery out by the configured interval", async () => {
  const stagger = 30;
  const comm = new CommController({ broadcastStaggerMs: stagger });
  comm.registerActor("ns-lead");
  comm.registerActor("ns-a");
  comm.registerActor("ns-b");
  comm.registerActor("ns-c");
  comm.registerPlan("ns", []);
  await comm.broadcast("ns-lead", "ns", { kind: "kickoff" });
  const emitted = comm
    .events()
    .filter((event) => event.type === "message_emitted")
    .map((event) => new Date(event.at).getTime());
  assert.equal(emitted.length, 3);
  assert.ok(emitted[1] - emitted[0] >= stagger - 5, "second recipient must wait roughly one interval");
  assert.ok(emitted[2] - emitted[1] >= stagger - 5, "third recipient must wait roughly one interval");
});

test("broadcast delivers recipients in stable registration order, not randomized", async () => {
  const comm = new CommController({ broadcastStaggerMs: 5 });
  comm.registerActor("ns-lead");
  comm.registerActor("ns-first");
  comm.registerActor("ns-second");
  comm.registerActor("ns-third");
  comm.registerPlan("ns", []);
  const result = await comm.broadcast("ns-lead", "ns", { kind: "kickoff" });
  const order = comm
    .events()
    .filter((event) => event.type === "message_emitted")
    .map((event) => event.to);
  assert.deepEqual(order, ["ns-first", "ns-second", "ns-third"]);
  assert.equal(result.recipients.length, 3);
});

test("a broadcast with zero or one recipient never waits", async () => {
  const comm = new CommController({ broadcastStaggerMs: 500 });
  comm.registerActor("ns-lead");
  comm.registerActor("ns-only");
  comm.registerPlan("ns", []);
  const start = Date.now();
  const result = await comm.broadcast("ns-lead", "ns", { kind: "kickoff" });
  assert.equal(result.recipients.length, 1);
  assert.ok(Date.now() - start < 20);
});
