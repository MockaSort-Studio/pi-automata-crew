import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  appendLifecycleEvent,
  findOwnerLostAttempts,
  lifecycleLogPath,
  readLifecycleEvents,
  replayLifecycleState,
  runIdForConfig,
} from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-log.mjs";

const withTempCwd = async (run) => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-log-"));
  try {
    return await run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test("runIdForConfig derives a run id from a crew-<runId> namespace", () => {
  assert.equal(runIdForConfig({ namespace: "crew-abc-123" }), "abc-123");
});

test("spawns without a namespace each get their own run log instead of sharing one", () => {
  assert.equal(runIdForConfig({}, "actor-1"), "adhoc-actor-1");
  assert.notEqual(runIdForConfig(undefined, "actor-1"), runIdForConfig(undefined, "actor-2"));
});

test("the duplicate index stays correct when another writer appends to the same log", () =>
  withTempCwd((cwd) => {
    const runId = "run-shared";
    appendLifecycleEvent(cwd, runId, { eventId: "e1", actor: "a", to: "running" });
    // Another process appends behind this one's cached index.
    appendFileSync(
      lifecycleLogPath(cwd, runId),
      `${JSON.stringify({ version: 2, eventId: "e2", actor: "b", to: "running" })}\n`,
    );
    const third = appendLifecycleEvent(cwd, runId, { eventId: "e3", actor: "c", to: "running" });
    assert.equal(third.event.version, 3, "versions stay unique and monotonic");
    assert.equal(appendLifecycleEvent(cwd, runId, { eventId: "e2", actor: "b", to: "x" }).appended, false);
    assert.equal(readLifecycleEvents(cwd, runId).length, 3);
  }));

test("an attempt owned by a live Lifecycle server is never recovered by another server", () =>
  withTempCwd((cwd) => {
    const deadWorker = 999_999;
    // Same dead worker pid, different owners: a live owner means its own server will record the exit.
    appendLifecycleEvent(cwd, "run-own", {
      eventId: "o1",
      actor: "mine",
      to: "running",
      pid: deadWorker,
      owner: process.pid,
    });
    appendLifecycleEvent(cwd, "run-own", {
      eventId: "o2",
      actor: "theirs",
      to: "running",
      pid: deadWorker,
      owner: 999_998,
    });
    assert.deepEqual(
      findOwnerLostAttempts(cwd).map((attempt) => attempt.actor),
      ["theirs"],
    );
  }));

test("a live worker with a very long command line is still recognised as alive", () =>
  withTempCwd(async (cwd) => {
    // The actor id sits at the end of a command line far longer than any terminal width.
    const padding = "x".repeat(600);
    const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", padding, "runs/long-actor"], {
      stdio: "ignore",
    });
    try {
      appendLifecycleEvent(cwd, "run-long", { eventId: "l1", actor: "long-actor", to: "running", pid: worker.pid });
      assert.deepEqual(findOwnerLostAttempts(cwd), []);
    } finally {
      worker.kill("SIGKILL");
    }
  }));

test("a live process that reuses a dead worker's pid is not mistaken for that worker", () =>
  withTempCwd(async (cwd) => {
    const stranger = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      appendLifecycleEvent(cwd, "run-pid", { eventId: "p1", actor: "dead-worker", to: "running", pid: stranger.pid });
      assert.deepEqual(findOwnerLostAttempts(cwd), [{ runId: "run-pid", actor: "dead-worker", from: "running" }]);
    } finally {
      stranger.kill("SIGKILL");
    }
  }));

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
