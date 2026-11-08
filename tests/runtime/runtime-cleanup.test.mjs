import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import { skipWithoutGit } from "./requires-git.mjs";
import { Runtime } from "../../extensions/crew/crew-runtime/lib/runtime.mjs";

const actors = (prefix) => ["a", "b"].map((name) => ({ name, actorId: `${prefix}-${name}`, task: "Reply done." }));

test("concurrent Crews remove workers and worktrees before Runtime stop returns", async (t) => {
  if (skipWithoutGit(t)) return;
  const cwd = mkdtempSync(join(tmpdir(), "runtime-cleanup-"));
  const first = new Runtime(cwd);
  const second = new Runtime(cwd);
  const ids = [`cleanup-${randomUUID()}`, `cleanup-${randomUUID()}`];
  try {
    // Runtime loads its worker module from the installed source, not the worktree.
    // This test uses no bundles or sandbox; worktree sync needs an empty extensions directory.
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "test"], { cwd });
    mkdirSync(join(cwd, "extensions"), { recursive: true });
    writeFileSync(join(cwd, ".gitignore"), ".pi/runtime/\n");
    execFileSync("git", ["add", ".gitignore"], { cwd });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
    const launches = await Promise.allSettled([first.launchCrew(actors(ids[0])), second.launchCrew(actors(ids[1]))]);
    for (const launch of launches) if (launch.status === "rejected") throw launch.reason;
    const [one, two] = launches.map((launch) => launch.value);
    assert.notEqual(realpathSync(cwd), realpathSync(process.cwd()), "the crews must not use the shared checkout");
    const ownedWorktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
    const paths = ownedWorktrees
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => realpathSync(line.slice(9)));
    for (const agent of [...one.agents, ...two.agents]) {
      assert.ok(paths.includes(realpathSync(agent.worktree)));
      const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: agent.worktree,
        encoding: "utf8",
      }).trim();
      assert.equal(realpathSync(resolve(agent.worktree, commonDir)), realpathSync(join(cwd, ".git")));
    }
    assert.equal((await first.list()).length, 2);
    assert.equal((await second.list()).length, 2);
    const stops = await Promise.allSettled([first.stop(), second.stop()]);
    for (const stop of stops) if (stop.status === "rejected") throw stop.reason;
    const stopped = stops.map((stop) => stop.value);
    assert.deepEqual(
      stopped.map((result) => result.removals.length),
      [2, 2],
    );
    assert.ok(
      stopped.every((result) => result.removals.every((item) => item.removed)),
      `a worker was not removed: ${JSON.stringify(stopped.flatMap((result) => result.removals.filter((item) => !item.removed)))}`,
    );
    for (const id of ids.flatMap((prefix) => actors(prefix).map((agent) => agent.actorId)))
      assert.equal(existsSync(join(cwd, ".pi", "runtime", "runs", id)), false);
    const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
    assert.doesNotMatch(worktrees, new RegExp(ids.join("|")));
  } finally {
    await Promise.allSettled([first.stop(), second.stop()]);
    rmSync(cwd, { recursive: true, force: true });
  }
});
