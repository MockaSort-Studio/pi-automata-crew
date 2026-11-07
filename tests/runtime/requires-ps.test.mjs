import test from "node:test";
import assert from "node:assert/strict";
import { skipWithoutWidePs } from "./requires-ps.mjs";

test("ps capability skips only when the exact invocation is unsupported", () => {
  const skipped = [];
  const t = { skip: (reason) => skipped.push(reason) };
  const probe = (result) => (command, args, options) => {
    assert.equal(command, "ps");
    assert.deepEqual(args, ["-ww", "-p", String(process.pid), "-o", "command="]);
    assert.equal(options.encoding, "utf8");
    return result;
  };
  assert.equal(
    skipWithoutWidePs(t, probe({ status: 1, stderr: "ps: unrecognized option: w\nUsage: ps [-o COL]" })),
    true,
  );
  assert.match(skipped[0], /ps.*not supported/i);
  assert.equal(skipWithoutWidePs(t, probe({ status: 0, stdout: "node\n" })), false);
  assert.throws(() => skipWithoutWidePs(t, probe({ status: 1, stderr: "permission denied" })), /ps.*failed/i);
  assert.throws(() => skipWithoutWidePs(t, probe({ status: 1, stderr: "" })), /ps.*failed/i);
  assert.throws(() => skipWithoutWidePs(t, probe({ error: new Error("denied") })), /denied/);
  assert.equal(skipped.length, 1);
});
