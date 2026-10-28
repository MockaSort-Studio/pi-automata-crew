import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LifecycleController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-controller.mjs";

const stubWorker = new URL("./fixtures/stub-worker.mjs", import.meta.url).pathname;

function gitRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "sandbox-contract-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "test"], { cwd });
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".pi/runtime/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return cwd;
}

test("Lifecycle writes Crew's Gondolin sandbox to worker config without adding one to standalone workers", async () => {
  const cwd = gitRepo();
  const preflight = async (config) => {
    if (config.sandbox) assert.deepEqual(config.sandbox, { kind: "gondolin" });
  };
  const controller = new LifecycleController({ cwd, workerModule: stubWorker, preflight });
  try {
    const crew = await controller.spawn({
      actorId: "crew-worker",
      name: "crew-worker",
      task: "DUMP_SANDBOX",
      sandbox: { kind: "gondolin" },
    });
    await new Promise((resolve) => crew.child.once("exit", resolve));
    assert.deepEqual(JSON.parse(readFileSync(join(crew.worktree, "sandbox.json"), "utf8")), { kind: "gondolin" });
    await controller.remove(crew.id);
    const standalone = await controller.spawn({
      actorId: "standalone-worker",
      name: "standalone-worker",
      task: "DUMP_SANDBOX",
    });
    await new Promise((resolve) => standalone.child.once("exit", resolve));
    assert.equal(readFileSync(join(standalone.worktree, "sandbox.json"), "utf8"), "null");
    await controller.remove(standalone.id);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("sandbox preflight failure prevents a worker worktree from being launched", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({
    cwd,
    workerModule: stubWorker,
    preflight: async () => {
      throw new Error("Gondolin unavailable");
    },
  });
  try {
    await assert.rejects(
      controller.spawn({
        actorId: "blocked-worker",
        name: "blocked-worker",
        task: "SUCCEED",
        sandbox: { kind: "gondolin" },
      }),
      /Gondolin unavailable/,
    );
    assert.equal(existsSync(join(cwd, ".pi", "runtime", "runs", "blocked-worker")), false);
    assert.deepEqual(await controller.list(), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
