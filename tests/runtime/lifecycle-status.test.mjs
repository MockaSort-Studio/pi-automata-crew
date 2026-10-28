import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { LifecycleController, terminalStatus } from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-controller.mjs";

const stubWorker = new URL("./fixtures/stub-worker.mjs", import.meta.url).pathname;

test("terminalStatus prefers 'removed' over a signal-kill misdiagnosis during intentional stop", () => {
  assert.equal(terminalStatus("stopping", null), "removed");
  assert.equal(terminalStatus("stopping", 1), "removed");
  assert.equal(terminalStatus("running", 0), "completed");
  assert.equal(terminalStatus("running", 1), "failed");
});

function gitRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-status-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "test"], { cwd });
  // Runtime state must never be treated as untracked worktree content.
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".pi/runtime/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return cwd;
}

test("removing a live worker terminalizes its state as 'removed', not 'failed'", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    const agent = await controller.spawn({ actorId: "live", name: "live", task: "SLEEP", namespace: "crew-smoke" });
    assert.equal(agent.status, "running");
    assert.equal(agent.namespace, "crew-smoke");
    const result = await controller.remove(agent.id);
    assert.deepEqual(result, { id: "live", removed: true, status: "removed" });
    assert.deepEqual(await controller.list(), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("removing an already-completed worker still terminalizes cleanly", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    const agent = await controller.spawn({ actorId: "done", name: "done", task: "SUCCEED" });
    await once(agent.child, "exit");
    assert.equal(agent.status, "completed");
    const result = await controller.remove(agent.id);
    assert.deepEqual(result, { id: "done", removed: true, status: "removed" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("inspecting a removed worker still returns its session context metrics", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    const agent = await controller.spawn({
      actorId: "turned",
      name: "turned",
      task: "TURN",
      model: "claude-sonnet-4-6",
    });
    await once(agent.child, "exit");
    const before = await controller.inspect(agent.id);
    assert.equal(before.metrics.turns, 1);
    assert.equal(before.metrics.sessionContext.modelWindow, 200_000);
    assert.equal(before.metrics.sessionContext.lastPercent, 0.1);
    await controller.remove(agent.id);
    const after = await controller.inspect(agent.id);
    assert.equal(after.found, true);
    assert.equal(after.retained, true);
    assert.deepEqual(after.metrics, before.metrics);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
