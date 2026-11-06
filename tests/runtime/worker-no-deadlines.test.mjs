import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bashOperations } from "../../extensions/crew/env-runtime/lib/gondolin-worker-shell.mjs";

test("guest bash does not abort an executing command on the supplied timeout, but retains cancellation", async () => {
  let captured;
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const vm = {
    exec(_args, options) {
      captured = options.signal;
      return Object.assign(done, {
        async *output() {
          await done;
        },
      });
    },
  };
  const operation = bashOperations(vm, process.cwd());
  const controller = new AbortController();
  const running = operation.exec("work", process.cwd(), { onData() {}, signal: controller.signal, timeout: 0.001 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(captured.aborted, false);
  controller.abort();
  assert.equal(captured.aborted, true);
  finish({ exitCode: 0 });
  await running;
});

test("worker supervisors do not install automatic tool or delivery deadlines", () => {
  for (const file of ["worker.mjs", "worker-comm-extension.mjs"]) {
    const source = readFileSync(new URL(`../../extensions/crew/crew-runtime/lib/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /TOOL_TIMEOUT_MS|DELIVERY_TIMEOUT_MS|terminateHungTool|armToolDeadline/);
  }
});
