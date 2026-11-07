import { strict as assert } from "node:assert";
import test from "node:test";
import {
  EXEC_WRAPPER,
  KILL_SCRIPT,
  bashOperations,
} from "../../extensions/crew/env-runtime/lib/gondolin-worker-shell.mjs";

const finished = (value = {}) =>
  Object.assign(Promise.resolve({ exitCode: 0, ...value }), { output: async function* () {} });
const hanging = () => {
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  return Object.assign(pending, {
    release: () => release({ exitCode: 0 }),
    output: async function* () {
      await pending;
    },
  });
};

test("the command travels as one argv element and the host exec is not bound to the abort signal", async () => {
  const calls = [];
  const vm = { exec: (argv, options) => (calls.push({ argv, options }), finished()) };
  const nasty = `echo "$(id)"; '\n' && rm -rf /`;
  await bashOperations(vm, "/p").exec(nasty, "/p", { onData() {}, signal: new AbortController().signal });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv.slice(0, 3), ["/bin/sh", "-c", EXEC_WRAPPER]);
  assert.equal(calls[0].argv.at(-1), nasty);
  assert.equal(calls[0].options.signal, undefined, "an aborted host session would detach from a live command");
});

test("abort runs the guest kill script for the same id and settles even if the guest is unreachable", async () => {
  const calls = [];
  const main = hanging();
  const vm = {
    exec(argv) {
      calls.push(argv);
      return calls.length === 1 ? main : Promise.reject(new Error("guest unreachable"));
    },
  };
  const controller = new AbortController();
  const running = bashOperations(vm, "/p", { abortSettleMs: 20 }).exec("sleep 1", "/p", {
    onData() {},
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(running, /^Error: aborted$/);
  assert.equal(calls[1][2], KILL_SCRIPT);
  assert.equal(calls[1][4], calls[0][4], "kill targets the id of the command that was started");
});

test("an explicit timeout cancels through the same kill path and reports timeout:<n>", async () => {
  const calls = [];
  const vm = { exec: (argv) => (calls.push(argv), calls.length === 1 ? hanging() : finished()) };
  await assert.rejects(
    bashOperations(vm, "/p", { abortSettleMs: 20 }).exec("sleep 99", "/p", { onData() {}, timeout: 0.05 }),
    /^Error: timeout:0\.05$/,
  );
  assert.equal(calls[1][2], KILL_SCRIPT);
  assert.equal(calls[1][4], calls[0][4]);
});

test("no timeout means no deadline: a long command is left alone", async () => {
  const calls = [];
  const slow = hanging();
  const vm = { exec: (argv) => (calls.push(argv), slow) };
  const running = bashOperations(vm, "/p").exec("make", "/p", { onData() {} });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(calls.length, 1, "nothing is killed without an abort or an explicit timeout");
  slow.release();
  assert.deepEqual(await running, { exitCode: 0 });
});
