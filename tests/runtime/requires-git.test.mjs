import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutGit } from "./requires-git.mjs";

test("git capability skips only when the executable is missing", () => {
  const skipped = [];
  const t = { skip: (reason) => skipped.push(reason) };
  const probe = (result) => (command, args) => {
    assert.equal(command, "git");
    assert.deepEqual(args, ["--version"]);
    return result;
  };
  assert.equal(skipWithoutGit(t, probe({ error: Object.assign(new Error("missing"), { code: "ENOENT" }) })), true);
  assert.match(skipped[0], /git.*not available/i);
  assert.equal(skipWithoutGit(t, probe({ status: 0 })), false);
  assert.throws(() => skipWithoutGit(t, probe({ status: 1 })), /git --version/);
  assert.throws(
    () => skipWithoutGit(t, probe({ error: Object.assign(new Error("denied"), { code: "EACCES" }) })),
    /denied/,
  );
  assert.equal(skipped.length, 1);
});
