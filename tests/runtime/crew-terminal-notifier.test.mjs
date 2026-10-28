import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createCrewTerminalNotifier } from "../../.pi/extensions/hall-crew/crew-runtime/lib/crew-terminal-notifier.mjs";

const snap = (namespace, statuses) => ({
  namespace,
  nodes: statuses.map((status, i) => ({ handle: `worker-${i}`, status })),
});

test("notifies Main once only after a nonempty typed run becomes terminal", async () => {
  const sent = [];
  const notifier = createCrewTerminalNotifier((message, options) => sent.push({ message, options }));
  assert.equal(notifier.observe({ namespace: "run-empty", nodes: [] }), false);
  assert.equal(notifier.observe(snap("run-1", ["running", "complete"])), false);
  assert.equal(notifier.observe(snap("run-1", ["complete", "blocked"])), true);
  assert.equal(notifier.observe(snap("run-1", ["complete", "blocked"])), false);
  await Promise.resolve();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].message, {
    customType: "crew-terminal",
    content: "Crew run-1 reached terminal lifecycle state (1 complete, 1 blocked).",
    display: true,
    details: { namespace: "run-1", counts: { complete: 1, blocked: 1, failed: 0 } },
  });
  assert.deepEqual(sent[0].options, { triggerTurn: true, deliverAs: "followUp" });
});

test("partial and empty runs never notify, and runs are independent", () => {
  const sent = [];
  const notifier = createCrewTerminalNotifier(() => sent.push(true));
  notifier.observe(snap("run-a", ["complete", "failed"]));
  notifier.observe(snap("run-b", ["complete", "running"]));
  assert.equal(sent.length, 1);
});
