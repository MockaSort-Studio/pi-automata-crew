import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { skipWithoutGit } from './requires-git.mjs';
import { LifecycleController } from "../../extensions/crew/crew-runtime/lib/lifecycle-controller.mjs";
import { connectLifecycle } from "../../extensions/crew/crew-runtime/lib/lifecycle-client.mjs";
import {
  appendLifecycleEvent,
  lifecycleLogPath,
  readLifecycleEvents,
} from "../../extensions/crew/crew-runtime/lib/lifecycle-log.mjs";

const stubWorker = new URL("./fixtures/stub-worker.mjs", import.meta.url).pathname;
const serverPath = new URL("../../extensions/crew/crew-runtime/lib/lifecycle-server.mjs", import.meta.url).pathname;

function gitRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-recovery-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "test"], { cwd });
  mkdirSync(join(cwd, "extensions"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".pi/runtime/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return cwd;
}

const waitForPort = async (child) => {
  const [data] = await once(child.stdout, "data");
  return JSON.parse(String(data)).port;
};

// The durable append that follows a child's "exit" event is asynchronous,
// so an exit observed by a test can briefly race the controller's own write.
const waitForEventCount = async (cwd, runId, count, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await readLifecycleEvents(cwd, runId);
    if (events.length >= count) return events;
    if (Date.now() > deadline) return events;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("a worker state change is durably logged before memory is updated, and replay reconstructs it after a restart", async (t) => {
  if (skipWithoutGit(t)) return;
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    const agent = await controller.spawn({
      actorId: "replay-me",
      name: "replay-me",
      task: "SLEEP",
      namespace: "crew-run-x",
    });
    const onDisk = await readLifecycleEvents(cwd, "run-x");
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].to, "running");
    assert.equal(onDisk[0].actor, "replay-me");

    // A fresh controller, as after a Lifecycle server restart, replays the
    // same log instead of trusting any in-memory state.
    const restarted = new LifecycleController({ cwd, workerModule: stubWorker });
    await restarted.recover();
    const afterRestart = await readLifecycleEvents(cwd, "run-x");
    // The still-alive worker (this test process is its own live pid proxy
    // via the real child) is not owner_lost: recovery must not invent a
    // terminal fact for a resource that is still there.
    assert.equal(afterRestart.length, 1);

    await controller.remove(agent.id);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("recover() is idempotent: replaying twice never double-records owner_lost for the same dead attempt", async (t) => {
  if (skipWithoutGit(t)) return;
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    // A durable record left at "running" with a pid that cannot exist on
    // this host, as if its owning process and the prior Lifecycle server
    // both died before either recorded a terminal fact.
    await appendLifecycleEvent(cwd, "run-dup", {
      eventId: randomUUID(),
      actor: "ghost",
      from: null,
      to: "running",
      pid: 999_999,
    });
    mkdirSync(join(cwd, ".pi", "runtime", "runs", "ghost"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "runtime", "runs", "ghost", "worker.json"), "{}");

    await controller.recover();
    await controller.recover();
    const events = await readLifecycleEvents(cwd, "run-dup");
    const ownerLost = events.filter((event) => event.to === "owner_lost");
    assert.equal(ownerLost.length, 1);
    assert.equal(ownerLost[0].actor, "ghost");
    assert.equal(existsSync(join(cwd, ".pi", "runtime", "archive", "ghost", "worker.json")), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a retry is a new linked attempt and the prior attempt's log is unchanged", async (t) => {
  if (skipWithoutGit(t)) return;
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    const original = await controller.spawn({
      actorId: "orig",
      name: "orig",
      task: "FAIL",
      namespace: "crew-run-retry",
    });
    await once(original.child, "exit");
    const beforeRetry = await waitForEventCount(cwd, "run-retry", 2);
    assert.equal(beforeRetry.length, 2);
    assert.equal(beforeRetry[1].to, "failed");

    const retry = await controller.spawn({
      actorId: "orig-retry-1",
      name: "orig",
      task: "SLEEP",
      namespace: "crew-run-retry",
      retryOf: "orig",
    });
    const afterRetry = await readLifecycleEvents(cwd, "run-retry");
    // The prior attempt's two events are byte-for-byte unchanged.
    assert.deepEqual(afterRetry.slice(0, 2), beforeRetry);
    assert.equal(afterRetry.length, 3);
    assert.equal(afterRetry[2].actor, "orig-retry-1");
    assert.equal(afterRetry[2].retryOf, "orig");
    assert.equal(afterRetry[2].to, "running");

    await controller.remove(retry.id);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Lifecycle server startup recovers an orphaned worker as owner_lost and archives its evidence", async (t) => {
  if (skipWithoutGit(t)) return;
  const cwd = gitRepo();
  let serverA, serverB;
  try {
    serverA = spawn(process.execPath, [serverPath, JSON.stringify({ cwd, workerModule: stubWorker })], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const portA = await waitForPort(serverA);
    const clientA = await connectLifecycle(`ws://127.0.0.1:${portA}`);
    const agent = await clientA.spawn({
      actorId: "orphan",
      name: "orphan",
      task: "SLEEP",
      namespace: "crew-run-orphan",
    });
    clientA.close();

    // Simulate a crash: the Lifecycle server dies without recording the
    // worker's exit, and the worker's own process is gone too (e.g. host
    // restart), so the durable log is left at "running" with no terminal
    // fact and a now-dead pid.
    serverA.kill("SIGKILL");
    await once(serverA, "exit");
    try {
      process.kill(-agent.pid, "SIGKILL");
    } catch {}

    serverB = spawn(process.execPath, [serverPath, JSON.stringify({ cwd, workerModule: stubWorker })], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    await waitForPort(serverB);

    const events = await readLifecycleEvents(cwd, "run-orphan");
    assert.equal(events.length, 2);
    assert.equal(events[0].to, "running");
    assert.equal(events[1].to, "owner_lost");
    assert.equal(events[1].actor, "orphan");
    assert.equal(events[1].from, "running");
    assert.equal(existsSync(join(cwd, ".pi", "runtime", "archive", "orphan")), true);
    // Evidence is safe, so the leaked run directory and git worktree registration are reclaimed.
    assert.equal(existsSync(join(cwd, ".pi", "runtime", "runs", "orphan")), false);
    assert.doesNotMatch(execFileSync("git", ["worktree", "list"], { cwd, encoding: "utf8" }), /runs\/orphan/);
  } finally {
    if (serverA?.exitCode === null) serverA.kill("SIGKILL");
    if (serverB?.exitCode === null) serverB.kill("SIGKILL");
    rmSync(cwd, { recursive: true, force: true });
  }
});

test(
  "a failed durable write after spawn is counted, never thrown, and the worker's exit is still recorded in memory",
  {
    skip: process.getuid?.() === 0 && "root ignores file permissions",
  },
  async () => {
    const cwd = gitRepo();
    const controller = new LifecycleController({ cwd, workerModule: stubWorker });
    try {
      const agent = await controller.spawn({
        actorId: "unwritable",
        name: "unwritable",
        task: "SLEEP",
        namespace: "crew-run-ro",
      });
      // The log becomes unwritable after the spawn fact: an exit write now fails inside a child "exit"
      // listener, where an exception would crash the whole Lifecycle server.
      chmodSync(lifecycleLogPath(cwd, "run-ro"), 0o444);
      process.kill(-agent.pid, "SIGKILL");
      await once(agent.child, "exit");
      assert.equal(agent.status, "failed", "the in-memory status still reaches its terminal value");
      assert.equal(controller.logFailures, 1, "the lost durable write is surfaced");
      await controller.remove(agent.id);
      assert.equal(controller.logFailures, 2, "a failed write never blocks removal");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);
