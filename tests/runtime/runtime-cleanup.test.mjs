import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { Runtime } from "../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs";

const actors = (prefix) => ["a", "b"].map((name) => ({ name, actorId: `${prefix}-${name}`, task: "Reply done." }));

test("concurrent Crews remove workers and worktrees before Runtime stop returns", async () => {
  const cwd = process.cwd();
  const first = new Runtime(cwd);
  const second = new Runtime(cwd);
  const ids = [`cleanup-${randomUUID()}`, `cleanup-${randomUUID()}`];
  try {
    const [one, two] = await Promise.all([first.launchCrew(actors(ids[0])), second.launchCrew(actors(ids[1]))]);
    assert.equal((await first.list()).length, 2);
    assert.equal((await second.list()).length, 2);
    const stopped = await Promise.all([first.stop(), second.stop()]);
    assert.ok(stopped.every((result) => result.removals.every((item) => item.removed)));
    for (const id of ids.flatMap((prefix) => actors(prefix).map((agent) => agent.actorId)))
      assert.equal(existsSync(join(cwd, ".pi", "runtime", "runs", id)), false);
    const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
    assert.doesNotMatch(worktrees, new RegExp(ids.join("|")));
  } finally {
    await Promise.allSettled([first.stop(), second.stop()]);
  }
});
