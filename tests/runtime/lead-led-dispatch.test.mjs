import { strict as assert } from "node:assert";
import test from "node:test";
import { CommController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs";
import { Runtime } from "../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs";
import { connectComm } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-client.mjs";

const runId = "44444444-4444-4444-4444-444444444444";
const ns = `crew-${runId}`;
const id = (handle) => `${ns}-${handle}`;
const plan = [
  { handle: "lead-old-major-00", dependsOn: [], task: "Deliver the feature" },
  { handle: "developer-a-00", dependsOn: [], task: "Build A" },
  { handle: "developer-b-00", dependsOn: ["developer-a-00"], task: "Build B after A" },
];

function broker() {
  const comm = new CommController({ broadcastStaggerMs: 0 });
  comm.registerActor(id("lead-old-major-00"), { role: "lead" });
  comm.registerActor(id("developer-a-00"), { role: "developer" });
  comm.registerActor(id("developer-b-00"), { role: "developer" });
  comm.registerPlan(ns, plan);
  return comm;
}
const lead = id("lead-old-major-00");
const progress = (comm, handle, state) => comm.lifecycleUpdate(id(handle), ns, state);

test("only the Lead may assign, and only plan members other than itself", () => {
  const comm = broker();
  assert.throws(() => comm.assign(id("developer-a-00"), ns, "developer-b-00"), /Only the Crew Lead/);
  assert.throws(() => comm.assign(lead, ns, "developer-zzz-00"), /Unknown Crew member/);
  assert.throws(() => comm.assign(lead, ns, "lead-old-major-00"), /cannot assign work to itself/);
});

test("an assignment is the plan's own task, from the Lead, exactly once", () => {
  const comm = broker();
  const sent = comm.assign(lead, ns, "developer-a-00", "x".repeat(5000));
  assert.equal(sent.accepted, true);
  const delivered = comm.claim(id("developer-a-00"));
  assert.equal(delivered.from, lead);
  assert.equal(delivered.payload.task, "Build A", "the Lead cannot substitute a different task");
  assert.equal(delivered.payload.reportTo, "lead-old-major-00");
  assert.deepEqual(delivered.payload.prerequisites, []);
  assert.equal(delivered.payload.note.length, 2000, "the note is bounded");
  assert.throws(() => comm.assign(lead, ns, "developer-a-00"), /already been assigned/);
});

test("a member is refused until every prerequisite is complete, then accepted", () => {
  const comm = broker();
  assert.throws(() => comm.assign(lead, ns, "developer-b-00"), /must wait for developer-a-00 to complete/);
  comm.assign(lead, ns, "developer-a-00");
  assert.throws(() => comm.assign(lead, ns, "developer-b-00"), /must wait for developer-a-00/, "assigned but not complete is still unmet");
  progress(comm, "developer-a-00", "running");
  progress(comm, "developer-a-00", "complete");
  assert.equal(comm.assign(lead, ns, "developer-b-00").accepted, true);
  assert.deepEqual(comm.claim(id("developer-b-00")).payload.prerequisites, ["developer-a-00"]);
});

test("a member blocked by a failed prerequisite cannot be assigned", () => {
  const comm = broker();
  progress(comm, "developer-a-00", "running");
  progress(comm, "developer-a-00", "failed");
  assert.throws(() => comm.assign(lead, ns, "developer-b-00"), /already blocked/);
});

test("Runtime briefs only the Lead and never releases members on its own", async (t) => {
  const runtime = new Runtime(process.cwd());
  const comm = await runtime.startComm(plan.map((m) => ({ actorId: id(m.handle), role: m.handle.split("-")[0] })), [], { namespace: ns, members: plan });
  const workers = {};
  const got = {};
  for (const { handle } of plan) {
    got[handle] = [];
    workers[handle] = await connectComm({ ...comm, actorId: id(handle), namespace: ns });
    workers[handle].onDelivery((m) => (got[handle].push(m), workers[handle].acknowledge(m.id)));
  }
  t.after(async () => {
    Object.values(workers).forEach((w) => w.close());
    await runtime.stop();
  });
  const result = await runtime.dispatchRoots(runId, "lead-led");
  assert.equal(result.leadLed, true);
  assert.deepEqual(result.recipients.map((r) => r.to), ["lead-old-major-00"]);
  assert.deepEqual(result.held, ["developer-a-00", "developer-b-00"]);
  await new Promise((r) => setTimeout(r, 60));
  const briefing = got["lead-old-major-00"][0].payload;
  assert.equal(briefing.task, "Deliver the feature");
  assert.deepEqual(briefing.members.map((m) => m.handle), ["developer-a-00", "developer-b-00"]);
  assert.match(briefing.instructions, /crew_assign/);
  assert.deepEqual([got["developer-a-00"].length, got["developer-b-00"].length], [0, 0]);

  // The Lead assigns A; B is released by nobody until the Lead assigns it.
  await workers["lead-old-major-00"].assign({ namespace: ns, to: "developer-a-00" });
  await workers["developer-a-00"].lifecycleUpdate(ns, "running");
  await workers["developer-a-00"].lifecycleUpdate(ns, "complete");
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(got["developer-a-00"].map((m) => m.payload.task), ["Build A"]);
  assert.equal(got["developer-b-00"].length, 0, "no automatic release in a Lead-led Crew");
  await workers["lead-old-major-00"].assign({ namespace: ns, to: "developer-b-00", note: "use A's output" });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(got["developer-b-00"].map((m) => [m.from, m.payload.task, m.payload.note]), [[lead, "Build B after A", "use A's output"]]);
});
