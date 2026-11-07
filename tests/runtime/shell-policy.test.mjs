import { strict as assert } from "node:assert";
import test from "node:test";
import { evaluateShellCommand } from "../../extensions/crew/runner/shell-policy.mjs";

test("rejects polling and nested sleep commands", () => {
  for (const command of [
    "sleep 280; tail log", "echo ok && sleep '280'", "sleep 1 20", "sleep $WAIT",
    "while true; do sleep 1; tail log; done", "until grep done log; do sleep 1; done",
    "while true; do tail log; done", "watch tail log", "( sleep 280 )",
    "bash -c 'sleep 280'", "eval 'sleep 280'", 'echo "$(sleep 280)"',
    "bash -c 'eval \"sleep 280\"'", "echo ok | sleep 280", "echo ok\nsleep 280",
  ]) assert.ok(evaluateShellCommand(command), command);
});

test("allows non-polling commands and text", () => {
  for (const command of ['echo "sleep"', 'grep -r sleep .', 'sleep 1', 'echo unrelated', "echo 'sleep 280'", "tail log", "while read line; do echo sleep; done < file"]) {
    assert.equal(evaluateShellCommand(command), null, command);
  }
});
