import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  appendLifecycleEvent,
  lifecycleLogPath,
  readLifecycleEvents,
  replayLifecycleState,
  runIdForConfig,
} from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-log.mjs";

const withTempCwd = (run) => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-log-"));
  try {
    return run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test("runIdForConfig derives a run id from a crew-<runId> namespace", () => {
  assert.equal(runIdForConfig({ namespace: "crew-abc-123" }), "abc-123");
  assert.equal(runIdForConfig({}), "default");
  assert.equal(runIdForConfig(undefined), "default");
});

test("appendLifecycleEvent writes one durable JSON line per call with a monotonic version", () =>
  withTempCwd(async (cwd) => {
    const runId = "run-1";
    await appendLifecycleEvent(cwd, runId, { eventId: randomUUID(), actor: "a", from: null, to: "running" });
    await appendLifecycleEvent(cwd, runId, { eventId: randomUUID(), actor: "a", from: "running", to: "completed" });
    const lines = readFileSync(lifecycleLogPath(cwd, runId), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const events = lines.map((line) => JSON.parse(line));
    assert.equal(events[0].version, 1);
    assert.equal(events[1].version, 2);
    assert.equal(events[1].from, "running");
    assert.ok(events[0].at);
  }));

test("a repeated eventId is a durable no-op", () =>
  withTempCwd(async (cwd) => {
    const runId = "run-2";
    const eventId = randomUUID();
    const first = await appendLifecycleEvent(cwd, runId, { eventId, actor: "a", from: null, to: "running" });
    const second = await appendLifecycleEvent(cwd, runId, {
      eventId,
      actor: "a",
      from: "running",
      to: "completed",
    });
    assert.equal(first.appended, true);
    assert.equal(second.appended, false);
    assert.deepEqual(second.event, first.event);
    const events = await readLifecycleEvents(cwd, runId);
    assert.equal(events.length, 1);
    assert.equal(events[0].to, "running");
  }));

test("replayLifecycleState rebuilds state from the raw log as if restarted", () =>
  withTempCwd(async (cwd) => {
    const runId = "run-3";
    await appendLifecycleEvent(cwd, runId, { eventId: randomUUID(), actor: "a", from: null, to: "running", pid: 1 });
    await appendLifecycleEvent(cwd, runId, { eventId: randomUUID(), actor: "a", from: "running", to: "completed" });
    // Simulate a process restart: read only what is durable on disk, nothing
    // held in memory from the appends above.
    const events = await readLifecycleEvents(cwd, runId);
    const attempts = replayLifecycleState(events);
    assert.equal(attempts.size, 1);
    const attempt = attempts.get("a");
    assert.equal(attempt.status, "completed");
    assert.equal(attempt.pid, 1);
    assert.equal(attempt.history.length, 2);
  }));

test("a retry is a linked new attempt that never edits the prior attempt's log", () =>
  withTempCwd(async (cwd) => {
    const runId = "run-4";
    await appendLifecycleEvent(cwd, runId, { eventId: randomUUID(), actor: "a", from: null, to: "running" });
    await appendLifecycleEvent(cwd, runId, { eventId: randomUUID(), actor: "a", from: "running", to: "failed" });
    const beforeRetry = await readLifecycleEvents(cwd, runId);
    await appendLifecycleEvent(cwd, runId, {
      eventId: randomUUID(),
      actor: "b",
      from: null,
      to: "running",
      retryOf: "a",
    });
    const events = await readLifecycleEvents(cwd, runId);
    // The two original "a" events are byte-for-byte unchanged.
    assert.deepEqual(events.slice(0, 2), beforeRetry);
    const attempts = replayLifecycleState(events);
    assert.equal(attempts.get("a").status, "failed");
    assert.equal(attempts.get("b").status, "running");
    assert.equal(attempts.get("b").retryOf, "a");
  }));
