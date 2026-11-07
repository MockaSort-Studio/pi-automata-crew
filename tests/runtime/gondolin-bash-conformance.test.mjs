import { strict as assert } from "node:assert";
import test from "node:test";
import { MemoryProvider, VM } from "@earendil-works/gondolin";
import { bashOperations } from "../../extensions/crew/env-runtime/lib/gondolin-worker-shell.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

// Conformance: the routed bash must behave like Pi's local bash tool (process-group kill on abort,
// return on shell exit rather than on descendant stream close, merged output, closed stdin).
const CWD = "/host/project";
const run = (ops, command, options = {}) => {
  let output = "";
  const started = Date.now();
  return ops
    .exec(command, CWD, { onData: (chunk) => (output += chunk.toString()), ...options })
    .then((result) => ({ ...result, output, ms: Date.now() - started }));
};
const guestHas = async (vm, pattern) =>
  (await vm.exec(`ps | grep -c '[${pattern[0]}]${pattern.slice(1)}'`)).stdout.trim() !== "0";

test("routed bash conforms to Pi's local bash semantics", { timeout: 240_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const vm = await VM.create({ vfs: { mounts: { "/workspace": new MemoryProvider() } } });
  t.after(() => vm.close());
  const ops = bashOperations(vm, CWD);

  await t.test("exit codes, quoting and merged stdout/stderr", async () => {
    assert.equal((await run(ops, "exit 3")).exitCode, 3);
    assert.equal((await run(ops, "kill -9 $$")).exitCode, 137, "a signal-killed shell reports 128+signal");
    const quoted = await run(ops, `printf '%s' 'a"b $c\\n'; echo out; echo err >&2`);
    assert.match(quoted.output, /^a"b \$c\\nout\nerr\n$/);
  });

  await t.test("stdin is closed, so readers see EOF", async () => {
    const result = await run(ops, "cat; printf after");
    assert.equal(result.output, "after");
  });

  await t.test("large output arrives intact", async () => {
    let bytes = 0;
    await ops.exec("head -c 2097152 /dev/zero", CWD, { onData: (chunk) => (bytes += chunk.length) });
    assert.equal(bytes, 2097152);
  });

  await t.test("a background child holding inherited output does not hold the call open", async () => {
    const result = await run(ops, "sleep 20 & printf done");
    assert.equal(result.output, "done");
    assert.equal(result.exitCode, 0);
    assert.ok(result.ms < 3000, `returned after ${result.ms} ms`);
    await run(ops, "pkill sleep; true");
  });

  await t.test("abort kills the whole guest process group and leaves the workspace usable", async () => {
    const controller = new AbortController();
    let started;
    const first = new Promise((resolve) => (started = resolve));
    const running = ops
      .exec("printf started; sleep 120 & sleep 120", CWD, { onData: () => started(), signal: controller.signal })
      .then(
        () => "returned",
        (error) => error.message,
      );
    await first;
    assert.equal(await guestHas(vm, "sleep 120"), true);
    const begin = Date.now();
    controller.abort();
    assert.equal(await running, "aborted");
    assert.ok(Date.now() - begin < 8000, `abort took ${Date.now() - begin} ms`);
    assert.equal(await guestHas(vm, "sleep 120"), false, "guest processes must not survive an abort");
    assert.equal((await run(ops, "echo ok >/workspace/after && cat /workspace/after")).output, "ok\n");
  });

  await t.test("an already-aborted signal never starts the command", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(run(ops, "touch /workspace/never", { signal: controller.signal }), /aborted/);
    assert.equal((await run(ops, "test -e /workspace/never; echo $?")).output, "1\n");
  });

  await t.test("an explicit timeout kills the command", async () => {
    const begin = Date.now();
    await assert.rejects(run(ops, "sleep 120", { timeout: 1 }), /timeout:1/);
    assert.ok(Date.now() - begin < 8000);
    assert.equal(await guestHas(vm, "sleep 120"), false);
  });

  await t.test("concurrent calls are independent and leave no temp files", async () => {
    const controller = new AbortController();
    const doomed = run(ops, "sleep 120", { signal: controller.signal }).then(
      () => "returned",
      (e) => e.message,
    );
    const fine = run(ops, "sleep 1; printf survivor");
    await new Promise((resolve) => setTimeout(resolve, 500));
    controller.abort();
    assert.equal(await doomed, "aborted");
    assert.equal((await fine).output, "survivor");
    const leftovers = (await vm.exec("ls /tmp/.crew-exec 2>/dev/null | wc -l")).stdout.trim();
    assert.equal(leftovers, "0");
  });
});
