import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createCrewTerminalNotifier } from "../../extensions/crew/crew/lib/crew-terminal-notifier.mjs";

const snap = (namespace, statuses) => ({
  namespace,
  nodes: statuses.map((status, i) => ({ handle: `worker-${i}`, status })),
});

test("notifies Main once only after a nonempty typed run becomes terminal", async () => {
  const sent = [];
  const notifier = createCrewTerminalNotifier((message, options) => sent.push({ message, options }));
  assert.equal(notifier.observe({ namespace: "run-empty", nodes: [] }), false);
  assert.equal(notifier.observe(snap("run-1", ["running", "complete"])), false);
  assert.equal(notifier.observe(snap("run-1", ["complete", "failed"])), true);
  assert.equal(notifier.observe(snap("run-1", ["complete", "failed"])), false);
  await Promise.resolve();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].message, {
    customType: "crew-terminal",
    content: "Crew run-1 reached terminal lifecycle state (1 complete, 1 failed).",
    display: true,
    details: { namespace: "run-1", counts: { complete: 1, blocked: 0, failed: 1 } },
  });
  assert.deepEqual(sent[0].options, { triggerTurn: true, deliverAs: "steer" });
});

test("a settled Crew with a blocked member asks for input, and notifies again after it resumes", async () => {
  const sent = [];
  const notifier = createCrewTerminalNotifier((message) => sent.push(message));
  assert.equal(notifier.observe(snap("run-1", ["complete", "blocked"])), true);
  assert.match(
    sent[0].content,
    /^Crew run-1 is waiting for input \(1 complete, 1 blocked\)\. A blocked member resumes/,
  );
  assert.equal(notifier.observe(snap("run-1", ["complete", "blocked"])), false);
  assert.equal(notifier.observe(snap("run-1", ["complete", "running"])), false);
  assert.equal(notifier.observe(snap("run-1", ["complete", "complete"])), true);
  assert.match(sent[1].content, /reached terminal lifecycle state \(2 complete\)/);
});

test("partial and empty runs never notify, and runs are independent", () => {
  const sent = [];
  const notifier = createCrewTerminalNotifier(() => sent.push(true));
  notifier.observe(snap("run-a", ["complete", "failed"]));
  notifier.observe(snap("run-b", ["complete", "running"]));
  assert.equal(sent.length, 1);
});

test("a crew whose blocked members Main already decided on is reported without asking for input or a turn", async () => {
  const sent = [];
  const notifier = createCrewTerminalNotifier((message, options) => sent.push({ message, options }));
  const node = (handle, status, state) => ({ handle, status, state });
  const decided = [node("a", "blocked", "on_hold"), node("b", "blocked", "held"), node("c", "complete", "completed")];
  assert.equal(notifier.observe({ namespace: "run-1", nodes: decided }), true);
  await Promise.resolve();
  assert.doesNotMatch(sent[0].message.content, /waiting for input/);
  assert.match(sent[0].message.content, /^Crew run-1 is settled \(1 complete, 2 blocked\)\. No member waits/);
  assert.deepEqual(sent[0].options, { triggerTurn: false });
  const handedOff = [node("a", "blocked", "handed_off"), node("b", "blocked", "needs_input")];
  assert.equal(notifier.observe({ namespace: "run-2", nodes: handedOff }), true);
  await Promise.resolve();
  assert.match(sent[1].message.content, /waiting for input/, "one member still asks Main");
  assert.deepEqual(sent[1].options, { triggerTurn: true, deliverAs: "steer" });
});

test("the crew host's settled-only snapshots notify again after resume(), and a forgotten run starts afresh", () => {
  const sent = [];
  const notifier = createCrewTerminalNotifier((message) => sent.push(message.content));
  assert.equal(notifier.observe(snap("run-1", ["complete", "blocked"])), true);
  assert.equal(notifier.observe(snap("run-1", ["complete", "complete"])), false, "no work seen in between");
  notifier.resume("run-1");
  assert.equal(notifier.observe(snap("run-1", ["complete", "complete"])), true);
  notifier.forget("run-1");
  assert.equal(notifier.observe(snap("run-1", ["complete", "complete"])), true, "a disposed run is not remembered");
  notifier.forget();
  assert.equal(notifier.observe(snap("run-1", ["complete", "complete"])), true);
  assert.equal(sent.length, 4);
});
