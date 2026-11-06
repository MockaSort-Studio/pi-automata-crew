import { strict as assert } from "node:assert";
import test from "node:test";
import { bashOperations } from "../../extensions/crew/env-runtime/lib/gondolin-worker-shell.mjs";
import {
  MAX_ALLOWED_SLEEP_SECONDS,
  SHELL_POLICY_REASON_CODES,
  ShellPolicyRejection,
  evaluateShellCommand,
} from "../../extensions/crew/env-runtime/lib/gondolin-worker-shell-policy.mjs";

// -- evaluateShellCommand: rejected patterns -------------------------------------------------

test("rejects a bare sleep longer than the allowed bound (issue #38 reproduction)", () => {
  const rejection = evaluateShellCommand("sleep 280; tail -n 50 /tmp/log.txt");
  assert.ok(rejection);
  assert.equal(rejection.reasonCode, SHELL_POLICY_REASON_CODES.LONG_SLEEP);
  assert.match(rejection.message, /sleep 280/);
});

test("rejects sleep chained after other shell separators (&&, ||, |, newline)", () => {
  for (const command of [
    "npm run build && sleep 300",
    "false || sleep 60",
    "echo hi | cat; sleep 42",
    "echo hi\nsleep 999",
  ]) {
    const rejection = evaluateShellCommand(command);
    assert.ok(rejection, `expected rejection for: ${command}`);
    assert.equal(rejection.reasonCode, SHELL_POLICY_REASON_CODES.LONG_SLEEP);
  }
});

test("rejects sleep with minute/hour/day suffixes once they exceed the bound", () => {
  assert.equal(evaluateShellCommand("sleep 1m").reasonCode, SHELL_POLICY_REASON_CODES.LONG_SLEEP);
  assert.equal(evaluateShellCommand("sleep 1h").reasonCode, SHELL_POLICY_REASON_CODES.LONG_SLEEP);
});

test("rejects sleep with an indeterminate (variable/expression) duration", () => {
  const rejection = evaluateShellCommand("sleep $DELAY && tail log.txt");
  assert.ok(rejection);
  assert.equal(rejection.reasonCode, SHELL_POLICY_REASON_CODES.INDETERMINATE_SLEEP);
});

test("rejects while/until polling loops that call sleep, regardless of sleep duration", () => {
  const loop = "i=0; while [ $i -lt 100 ]; do grep done.txt log.txt && break; sleep 1; i=$((i+1)); done";
  const rejection = evaluateShellCommand(loop);
  assert.ok(rejection);
  assert.equal(rejection.reasonCode, SHELL_POLICY_REASON_CODES.SLEEP_POLL_LOOP);
});

test("rejects until-loop polling variants", () => {
  const loop = "until grep -q READY status.log; do sleep 2; done";
  const rejection = evaluateShellCommand(loop);
  assert.ok(rejection);
  assert.equal(rejection.reasonCode, SHELL_POLICY_REASON_CODES.SLEEP_POLL_LOOP);
});

test("rejects the watch command as a bash-level command", () => {
  const rejection = evaluateShellCommand("watch -n 5 tail -n 20 /tmp/log.txt");
  assert.ok(rejection);
  assert.equal(rejection.reasonCode, SHELL_POLICY_REASON_CODES.WATCH_COMMAND);
});

// -- evaluateShellCommand: allowed patterns --------------------------------------------------

test("allows short bounded sleeps used for ordinary retry backoff", () => {
  assert.equal(evaluateShellCommand(`sleep ${MAX_ALLOWED_SLEEP_SECONDS}`), null);
  assert.equal(evaluateShellCommand("sleep 1 && npm test"), null);
  assert.equal(evaluateShellCommand("for i in 1 2 3; do curl -f $URL && break; sleep 1; done"), null);
});

test("allows ordinary commands with no sleep/watch/poll at all", () => {
  assert.equal(evaluateShellCommand("node --test tests/**/*.test.mjs"), null);
  assert.equal(evaluateShellCommand("tail -n 50 /tmp/log.txt"), null);
  assert.equal(evaluateShellCommand("git status"), null);
});

test("does not flag unrelated text that merely mentions sleep or watch", () => {
  assert.equal(evaluateShellCommand('echo "please sleep well tonight"'), null);
  assert.equal(evaluateShellCommand('git commit -m "watch out: fixes sleep handling"'), null);
  assert.equal(evaluateShellCommand("touch notes-about-sleep.txt"), null);
  assert.equal(evaluateShellCommand("grep -n sleep README.md"), null);
  assert.equal(evaluateShellCommand("cat watchlist.txt"), null);
});

// -- bashOperations.exec integration: rejection happens before any guest exec ----------------

function fakeVm() {
  let execCalled = false;
  return {
    vm: {
      exec() {
        execCalled = true;
        throw new Error("vm.exec should not be called for a rejected command");
      },
    },
    wasExecCalled: () => execCalled,
  };
}

test("bashOperations.exec rejects a polling sleep before touching the guest VM", async () => {
  const { vm, wasExecCalled } = fakeVm();
  const ops = bashOperations(vm, "/workspace");
  await assert.rejects(
    () => ops.exec("sleep 280; tail -n 50 /tmp/log.txt", "/workspace", { onData: () => {} }),
    (error) => {
      assert.ok(error instanceof ShellPolicyRejection);
      assert.equal(error.reasonCode, SHELL_POLICY_REASON_CODES.LONG_SLEEP);
      return true;
    },
  );
  assert.equal(wasExecCalled(), false);
});

test("bashOperations.exec still runs legitimate bounded commands through the guest VM", async () => {
  let received;
  const vm = {
    exec(argv, options) {
      received = { argv, options };
      return {
        async *output() {},
        then(resolve) {
          resolve({ exitCode: 0 });
        },
      };
    },
  };
  const ops = bashOperations(vm, "/workspace");
  const result = await ops.exec('echo "sleep well"', "/workspace", { onData: () => {} });
  assert.equal(result.exitCode, 0);
  assert.ok(received);
  assert.deepEqual(received.argv, ["/bin/sh", "-lc", 'echo "sleep well"']);
});
