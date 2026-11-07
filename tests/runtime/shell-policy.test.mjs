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
  ["for f in a b; do sleep 3; done", "long sleep in finite loop"],
  ["while read x; do sleep .1; done < file", "while input can be unbounded"],
  ["env sleep 300", "env wrapper"],
  ["/usr/bin/env sleep 300", "absolute env wrapper"],
  ["env VAR=x sleep 300", "env assignment"],
  ["timeout 400 sleep 300", "timeout wrapper"],
  ["nice sleep 300", "nice wrapper"],
  ["time sleep 300", "time wrapper"],
  ['while true; do bash -c "sleep 1"; done', "nested shell inherits loop"],
  ["while true; do echo $(sleep 1); done", "substitution inherits loop"],
  ["echo word#not-comment; sleep 300", "hash inside word is not comment"],
  ["sleep 10; sleep 10", "cumulative sleeps"],
  ["sleep 6; bash -c 'sleep 6'", "cumulative nested sleeps"],
  ["env -u VAR VAR=x sleep 300", "env option and assignment"],
  ["timeout -k 2 400 sleep 300", "timeout option and duration"],
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
  ["sleep 1 > /dev/null", "output redirection"],
  ["sleep 1 2>/dev/null", "descriptor redirection"],
  ["sleep 1 >> /dev/null", "append redirection"],
  ["sleep 1 < file", "input redirection"],
  ["sleep 1 &>/dev/null", "combined redirection"],
  ["sleep 1 2>&1", "descriptor duplication"],
  ["sleep 1 # short delay", "trailing comment"],
  ["echo ok #; sleep 300", "comment hides command"],
  ["for i in 1 2; do sleep .1; done", "short finite loop sleep"],
  ["select i in 1 2; do sleep 2; done", "short select loop sleep"],
  ["S=sleep; $S 300", "dynamic command known gap"],
  ["python3 -c 'import time; time.sleep(300)'", "python known gap"],
  ["perl -e 'sleep 300'", "perl known gap"],
  ["read -t 300 x", "read timeout known gap"],
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
