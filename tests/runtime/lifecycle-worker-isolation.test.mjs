import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { LifecycleController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-controller.mjs";

// A spawned worker must never receive host-root discovery: it runs inside
// its own owned worktree under .pi/runtime/runs/<id>/worktree and must not
// be handed an env var that lets it resolve or mutate the host repo's
// .pi/runtime state (see docs/crew/follow-ups.md).
const stubWorker = new URL("./fixtures/stub-worker.mjs", import.meta.url).pathname;

function gitRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-isolation-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "test"], { cwd });
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".pi/runtime/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return cwd;
}

test("a spawned worker's environment carries no host .pi/runtime discovery variable", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    const agent = await controller.spawn({ actorId: "dump", name: "dump", task: "DUMP_ENV" });
    await once(agent.child, "exit");
    const env = JSON.parse(readFileSync(join(agent.worktree, "env.json"), "utf8"));
    assert.equal(env.PI_CREW_ROOT, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
