import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lifecycleByActor } from "../../.pi/extensions/hall-crew/crew/lib/monitor-actor-state.mjs";
import { crewMonitorSnapshot } from "../../.pi/extensions/hall-crew/crew/lib/monitor-snapshot.mjs";

const roster = (members) => ({ runId: "run-1", status: "started", members });

test("lifecycleByActor omits a member with no recorded status, rather than defaulting it to queued", () => {
  const map = lifecycleByActor(roster([{ actorId: "actor-1" }]));
  assert.deepEqual(map, {});
});

test("lifecycleByActor keeps an explicitly recorded status", () => {
  const map = lifecycleByActor(roster([{ actorId: "actor-1", status: "PASS" }]));
  assert.deepEqual(map, { "actor-1": "PASS" });
});

test("lifecycleByActor skips a member with no actorId", () => {
  const map = lifecycleByActor(roster([{ status: "running" }]));
  assert.deepEqual(map, {});
});

// Regression: monitor.ts previously pre-filled every unrecorded status to
// the literal string "queued" before handing the map to crewMonitorSnapshot,
// which silently defeated bucketFor()'s worker-metrics activity fallback --
// a resident worker with real turns/tool calls stayed "queued" forever in
// the footer and dashboard because the entry was never actually absent.
test("a resident worker with live worker-metrics activity but no recorded status reads as running end to end", () => {
  const members = [{ actorId: "actor-1" }];
  const snapshot = crewMonitorSnapshot(roster(members), {
    lifecycleByActor: lifecycleByActor(roster(members)),
    workerMetricsByActor: { "actor-1": { turns: 19, toolCalls: 26 } },
  });
  assert.equal(snapshot.counts.running, 1);
  assert.equal(snapshot.counts.queued, 0);
});
