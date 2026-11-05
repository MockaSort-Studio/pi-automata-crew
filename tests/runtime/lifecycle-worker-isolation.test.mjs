import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { LifecycleController } from "../../extensions/crew/crew-runtime/lib/lifecycle-controller.mjs";

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
  mkdirSync(join(cwd, "extensions"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".pi/runtime/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
  return cwd;
}

test("owner shutdown archives a live worker before removing its run directory", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    const agent = await controller.spawn({ actorId: "owner-death", name: "owner-death", task: "SLEEP" });
    await controller.shutdown();
    assert.equal(existsSync(join(cwd, ".pi", "runtime", "runs", agent.id)), false);
    assert.equal(existsSync(join(cwd, ".pi", "runtime", "archive", agent.id, "worker.json")), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A worker that dies (or closes the pipe) before reading its token must not take the Lifecycle server
// down: an unhandled EPIPE on the pipe is an uncaught exception in the server process.
test("a worker that closes the token pipe unread does not crash the Lifecycle server", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  try {
    // Larger than a pipe buffer, so the write is still pending when the worker closes its end.
    const authToken = "x".repeat(300_000);
    const agent = await controller.spawn({
      actorId: "closes-fd",
      name: "closes-fd",
      task: "CLOSE_TOKEN_FD",
      comm: { url: "ws://127.0.0.1:1", actorId: "closes-fd", authToken },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal((await controller.list()).length, 1, "the server survived and still tracks the worker");
    await controller.remove(agent.id);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

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

// Per-actor Comm token confidentiality: the token reaches the worker only over a private pipe. It is
// never in worker.json (copied into the archive), nor in the environment (readable by any same-user
// process).
test("the Comm token reaches the worker over a private pipe, never its environment, worker.json or archive", async () => {
  const cwd = gitRepo();
  const controller = new LifecycleController({ cwd, workerModule: stubWorker });
  const token = "super-secret-comm-token-value";
  try {
    const agent = await controller.spawn({
      actorId: "token-check",
      name: "token-check",
      task: "DUMP_TOKEN",
      comm: { url: "ws://127.0.0.1:1", actorId: "token-check", authToken: token },
    });
    await once(agent.child, "exit");
    const dump = JSON.parse(readFileSync(join(agent.worktree, "token.json"), "utf8"));
    assert.equal(dump.fd3, token, "the worker receives the token on fd 3");
    assert.doesNotMatch(JSON.stringify(dump.env), new RegExp(token), "the token must not be in the environment");
    const configText = readFileSync(join(cwd, ".pi", "runtime", "runs", agent.id, "worker.json"), "utf8");
    assert.doesNotMatch(configText, new RegExp(token), "the token must never be written to worker.json");
    await controller.shutdown();
    const archiveText = readFileSync(join(cwd, ".pi", "runtime", "archive", agent.id, "worker.json"), "utf8");
    assert.doesNotMatch(archiveText, new RegExp(token), "the token must never be preserved in archived evidence");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
