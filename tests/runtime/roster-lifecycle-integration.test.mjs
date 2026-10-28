// Focused integration coverage: a real LifecycleController (backed by the
// cheap stub worker, never a real `pi` process) drives worker completion,
// failure, and intentional removal; each terminal status is then applied to
// a durable roster file through roster-lifecycle.mjs exactly as
// runtime/index.ts wires it.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { LifecycleController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-controller.mjs";
import { applyWorkerStatusToRosterFiles } from "../../.pi/extensions/hall-crew/crew/lib/roster-lifecycle.mjs";

const stubWorker = new URL("./fixtures/stub-worker.mjs", import.meta.url).pathname;

function gitRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "roster-lifecycle-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "test"], { cwd });
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".pi/runtime/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return cwd;
}

function writeRoster(crewLaunchDir, runId, actorId) {
  writeFileSync(
    join(crewLaunchDir, `${runId}-roster.json`),
    JSON.stringify({ runId, status: "started", members: [{ name: "worker", actorId }] }),
  );
}

test("a worker that completes naturally lands its roster member on PASS", async () => {
  const cwd = gitRepo();
  const crewLaunchDir = mkdtempSync(join(tmpdir(), "crew-launch-"));
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    writeRoster(crewLaunchDir, "run-pass", "actor-pass");
    const agent = await controller.spawn({ actorId: "actor-pass", name: "worker", task: "OK" });
    await once(agent.child, "exit");
    assert.equal(agent.status, "completed");

    const updated = applyWorkerStatusToRosterFiles(crewLaunchDir, agent.id, agent.status);

    assert.deepEqual(updated, [{ runId: "run-pass", actorId: "actor-pass", status: "PASS" }]);
    const roster = JSON.parse(readFileSync(join(crewLaunchDir, "run-pass-roster.json"), "utf8"));
    assert.equal(roster.members[0].status, "PASS");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(crewLaunchDir, { recursive: true, force: true });
  }
});

test("a worker that exits non-zero lands its roster member on FAIL", async () => {
  const cwd = gitRepo();
  const crewLaunchDir = mkdtempSync(join(tmpdir(), "crew-launch-"));
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    writeRoster(crewLaunchDir, "run-fail", "actor-fail");
    const agent = await controller.spawn({ actorId: "actor-fail", name: "worker", task: "FAIL" });
    await once(agent.child, "exit");
    assert.equal(agent.status, "failed");

    const updated = applyWorkerStatusToRosterFiles(crewLaunchDir, agent.id, agent.status);

    assert.deepEqual(updated, [{ runId: "run-fail", actorId: "actor-fail", status: "FAIL" }]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(crewLaunchDir, { recursive: true, force: true });
  }
});

test("an intentional removal lands its roster member on BLOCKED, not FAIL", async () => {
  const cwd = gitRepo();
  const crewLaunchDir = mkdtempSync(join(tmpdir(), "crew-launch-"));
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    writeRoster(crewLaunchDir, "run-removed", "actor-removed");
    const agent = await controller.spawn({ actorId: "actor-removed", name: "worker", task: "SLEEP" });
    const result = await controller.remove(agent.id);
    assert.equal(result.status, "removed");

    const updated = applyWorkerStatusToRosterFiles(crewLaunchDir, agent.id, result.status);

    assert.deepEqual(updated, [{ runId: "run-removed", actorId: "actor-removed", status: "BLOCKED" }]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(crewLaunchDir, { recursive: true, force: true });
  }
});
