import { strict as assert } from "node:assert";
import test from "node:test";
import { evaluateShellCommand } from "../../extensions/crew/runner/shell-policy.mjs";

const rejected = [
  ["sleep 280; tail log", "long sleep before log"],
  ["echo ok && sleep '280'", "quoted duration"],
  ["false || sleep 2m", "duration suffix"],
  ["sleep 1 20", "summed durations"],
  ["sleep $WAIT", "indeterminate duration"],
  ["while true; do sleep 1; tail log; done", "sleep loop"],
  ["until grep done log; do sleep 1; done", "until waiting"],
  ["while true; do tail log; done", "while true polling"],
  ["while :; do curl localhost; done", "while colon polling"],
  ["for f in a b; do sleep 1; done", "sleep in finite loop"],
  ["tail -f log", "tail follow"],
  ["tail --follow=name log", "tail follow long option"],
  ["watch tail log", "watch"],
  ["( sleep 280 )", "subshell"],
  ["bash -c 'sleep 280'", "bash nested"],
  ["sh -c 'while true; do sleep 1; done'", "sh nested loop"],
  ["eval 'sleep 280'", "eval nested"],
  ['echo "$(sleep 280)"', "command substitution"],
  ["echo `sleep 280`", "backticks"],
  ["bash -c 'eval \"sleep 280\"'", "nested eval"],
  ["echo ok | sleep 280", "pipeline"],
  ["echo ok\nsleep 280", "newline"],
];
const allowed = [
  ['for f in a b; do grep -n x "$f"; done', "finite grep loop"],
  ['for f in tests/*.mjs; do grep -n TODO "$f"; done', "finite glob loop"],
  ["for u in a b; do curl -s http://localhost/$u; done", "finite curl loop"],
  ["while read line; do echo $line; done < file", "input loop"],
  ['while read line; do grep x "$line"; done < file', "input loop with grep"],
  ['while [ "$i" -lt 3 ]; do curl localhost; i=$((i+1)); done', "counter loop"],
  ["npm test 2>&1 | tail -20", "single tail"],
  ["sleep 1", "short sleep"],
  ['echo "sleep 300"', "quoted text"],
  ["grep -r sleep .", "word in argument"],
  ["echo unrelated", "ordinary text"],
  ["echo 'sleep 280'", "single quoted text"],
  ["tail log", "single log read"],
];

test("rejects polling and nested sleep commands", () => {
  for (const [command, reason] of rejected) assert.ok(evaluateShellCommand(command), `${reason}: ${command}`);
});

test("allows bounded commands and unrelated text", () => {
  for (const [command, reason] of allowed) assert.equal(evaluateShellCommand(command), null, `${reason}: ${command}`);
});
