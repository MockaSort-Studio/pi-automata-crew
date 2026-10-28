import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  crewMonitorSnapshot,
  formatSessionContext,
  formatTokenCount,
} from "../../.pi/extensions/hall-crew/crew/lib/monitor-snapshot.mjs";

const roster = (overrides) => ({
  runId: "run-123456",
  status: "started",
  members: [
    { name: "architect-a", actorId: "actor-1", role: "specialist" },
    { name: "developer-b", actorId: "actor-2", role: "specialist" },
    { name: "developer-c", actorId: "actor-3", role: "specialist" },
  ],
  ...overrides,
});

test("crewMonitorSnapshot buckets automata by durable lifecycle state", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: { "actor-1": "running", "actor-2": "PASS", "actor-3": "BLOCKED" },
    workerMetricsByActor: {},
  });
  assert.equal(snapshot.runId, "run-123456");
  assert.deepEqual(snapshot.counts, {
    queued: 0,
    waiting: 0,
    running: 1,
    attention: 0,
    complete: 1,
    blocked: 1,
    failed: 0,
    total: 3,
  });
});

test("crewMonitorSnapshot defaults automata missing lifecycle entries to queued", () => {
  const snapshot = crewMonitorSnapshot(roster(), {});
  assert.equal(snapshot.counts.queued, 3);
  assert.equal(snapshot.counts.total, 3);
});

test("crewMonitorSnapshot buckets an actor with live worker-metrics evidence as running even without a terminal or running lifecycle entry", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: {},
    workerMetricsByActor: {
      "actor-1": { turns: 2, toolCalls: 0 },
      "actor-2": { turns: 0, toolCalls: 3 },
      "actor-3": { turns: 0, toolCalls: 0 },
    },
  });
  assert.deepEqual(snapshot.counts, {
    queued: 1,
    waiting: 0,
    running: 2,
    attention: 0,
    complete: 0,
    blocked: 0,
    failed: 0,
    total: 3,
  });
});

test("crewMonitorSnapshot keeps an actor queued when it has zero turns/events and no terminal status, even if a metrics record exists", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: {},
    workerMetricsByActor: {
      "actor-1": { turns: 0, toolCalls: 0, toolErrors: 0, compactions: 0 },
    },
  });
  assert.equal(snapshot.counts.queued, 3);
  assert.equal(snapshot.counts.running, 0);
});

test("crewMonitorSnapshot lets an explicit terminal lifecycle status take precedence over worker-metrics evidence", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: { "actor-1": "PASS" },
    workerMetricsByActor: {
      "actor-1": { turns: 5, toolCalls: 5 },
    },
  });
  assert.equal(snapshot.counts.complete, 1);
  assert.equal(snapshot.counts.running, 0);
});

test("crewMonitorSnapshot sums generated output tokens across worker metrics", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: { "actor-1": "running", "actor-2": "running", "actor-3": "running" },
    workerMetricsByActor: {
      "actor-1": { providerTraffic: { generatedOutput: 100 } },
      "actor-2": { providerTraffic: { generatedOutput: 250 } },
      // actor-3 has no metrics on disk yet
    },
  });
  assert.equal(snapshot.totalGeneratedOutputTokens, 350);
});

test("crewMonitorSnapshot ignores non-finite or missing generatedOutput safely", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    workerMetricsByActor: {
      "actor-1": { providerTraffic: { generatedOutput: Number.NaN } },
      "actor-2": {},
      "actor-3": null,
    },
  });
  assert.equal(snapshot.totalGeneratedOutputTokens, 0);
});

test("crewMonitorSnapshot rejects an unknown lifecycle node rather than silently miscounting", () => {
  assert.throws(
    () => crewMonitorSnapshot(roster(), { lifecycleByActor: { "actor-1": "bogus" } }),
    /Unknown Crew lifecycle state: bogus/,
  );
});

test("crewMonitorSnapshot handles an empty or missing roster", () => {
  assert.equal(crewMonitorSnapshot(null), null);
  const empty = crewMonitorSnapshot(roster({ members: [] }));
  assert.equal(empty.counts.total, 0);
  assert.equal(empty.totalGeneratedOutputTokens, 0);
  assert.deepEqual(empty.automata, []);
});

test("formatSessionContext renders 'percent / model window' from worker-metrics sessionContext", () => {
  assert.equal(formatSessionContext({ lastPercent: 42.3, modelWindow: 200000 }), "42.3% / 200k");
});

test("formatTokenCount uses compact k/M notation", () => {
  assert.equal(formatTokenCount(1000), "1k");
  assert.equal(formatTokenCount(1_000_000), "1M");
});

test("formatSessionContext falls back to an em-dash for unknown percent or window", () => {
  assert.equal(formatSessionContext({ lastPercent: null, modelWindow: 200000 }), "\u2014 / 200k");
  assert.equal(formatSessionContext({ lastPercent: 10, modelWindow: null }), "10% / \u2014");
  assert.equal(formatSessionContext(undefined), "\u2014 / \u2014");
});

test("crewMonitorSnapshot emits a per-automaton detail row with bucket, metrics, and session context", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: { "actor-1": "running" },
    workerMetricsByActor: {
      "actor-1": {
        turns: 4,
        toolCalls: 9,
        toolErrors: 1,
        compactions: 2,
        providerTraffic: { uncachedInput: 10, generatedOutput: 20, cacheRead: 30, cacheWrite: 5 },
        sessionContext: { lastPercent: 55, modelWindow: 128000 },
      },
    },
  });
  const row = snapshot.automata.find((entry) => entry.actorId === "actor-1");
  assert.deepEqual(row, {
    actorId: "actor-1",
    name: "architect-a",
    bucket: "running",
    turns: 4,
    toolCalls: 9,
    toolErrors: 1,
    compactions: 2,
    providerTraffic: { uncachedInput: 10, generatedOutput: 20, cacheRead: 30, cacheWrite: 5 },
    sessionContext: "55% / 128k",
  });
});

test("crewMonitorSnapshot defaults a missing worker-metrics entry to zeroed detail", () => {
  const snapshot = crewMonitorSnapshot(roster(), { lifecycleByActor: { "actor-3": "running" } });
  const row = snapshot.automata.find((entry) => entry.actorId === "actor-3");
  assert.equal(row.turns, 0);
  assert.equal(row.sessionContext, "\u2014 / \u2014");
});

// Regression: a worker's own completion report updates the dependency
// ledger immediately, but its roster-recorded status only advances once
// Main explicitly reconciles it -- which can lag arbitrarily. Without this
// fallback a finished member reads back as "running" (or "queued") forever
// until Main happens to act, not because anything is actually still going.
test("crewMonitorSnapshot reads a member as complete/blocked/failed from live ledger status when no roster entry is recorded yet", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: {},
    ledgerStatusByActor: { "actor-1": "complete", "actor-2": "blocked", "actor-3": "failed" },
  });
  assert.equal(snapshot.counts.complete, 1);
  assert.equal(snapshot.counts.blocked, 1);
  assert.equal(snapshot.counts.failed, 1);
  assert.equal(snapshot.counts.running, 0);
});

test("crewMonitorSnapshot lets an explicit roster-recorded status take precedence over live ledger status", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: { "actor-1": "running" },
    ledgerStatusByActor: { "actor-1": "complete" },
  });
  assert.equal(snapshot.counts.running, 1);
  assert.equal(snapshot.counts.complete, 0);
});

test("crewMonitorSnapshot falls back to live-activity evidence when the ledger reports a non-terminal status", () => {
  const snapshot = crewMonitorSnapshot(roster(), {
    lifecycleByActor: {},
    workerMetricsByActor: { "actor-1": { turns: 2, toolCalls: 0 } },
    ledgerStatusByActor: { "actor-1": "running" },
  });
  assert.equal(snapshot.counts.running, 1);
});
