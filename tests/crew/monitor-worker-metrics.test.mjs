import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { workerMetricsByActor } from "../../.pi/extensions/hall-crew/crew/lib/monitor-worker-metrics.mjs";

const withTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-worker-metrics-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const writeEvents = (cwd, configDirName, actorId, events) => {
  const dir = join(cwd, configDirName, "runtime", "runs", actorId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
};

test("workerMetricsByActor summarizes each member's own events.jsonl, keyed by actorId", () => {
  withTempDir((cwd) => {
    writeEvents(cwd, ".pi", "actor-1", [{ type: "turn", usage: {} }]);
    const roster = { members: [{ actorId: "actor-1" }] };
    const metrics = workerMetricsByActor(cwd, ".pi", roster);
    assert.ok(metrics["actor-1"]);
    assert.equal(metrics["actor-1"].turns, 1);
  });
});

test("workerMetricsByActor resolves sessionContext.modelWindow from the worker's own relayed model id, not launch config", () => {
  withTempDir((cwd) => {
    writeEvents(cwd, ".pi", "actor-1", [
      { type: "resolved_model", modelId: "anthropic/claude-sonnet-4-6" },
      { type: "turn", usage: { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100_000 } },
    ]);
    const roster = { members: [{ actorId: "actor-1" }] };
    const metrics = workerMetricsByActor(cwd, ".pi", roster);
    assert.equal(metrics["actor-1"].sessionContext.modelWindow, 200_000);
    assert.equal(metrics["actor-1"].sessionContext.lastPercent, 50);
  });
});

test("workerMetricsByActor degrades to all-zero counts when a member's run directory is already gone", () => {
  withTempDir((cwd) => {
    const roster = { members: [{ actorId: "gone-actor" }] };
    const metrics = workerMetricsByActor(cwd, ".pi", roster);
    assert.equal(metrics["gone-actor"].turns, 0);
  });
});

test("workerMetricsByActor skips a member with no actorId", () => {
  withTempDir((cwd) => {
    const roster = { members: [{ name: "no-actor-yet" }] };
    assert.deepEqual(workerMetricsByActor(cwd, ".pi", roster), {});
  });
});

test("workerMetricsByActor handles a roster with no members", () => {
  withTempDir((cwd) => {
    assert.deepEqual(workerMetricsByActor(cwd, ".pi", {}), {});
  });
});
