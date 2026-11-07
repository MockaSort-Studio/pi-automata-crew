import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createHostClient } from "../../extensions/crew/runner/host-client.mjs";

function fakeHost() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 1,
  });
  return { child, spawnImpl: () => child, say: (message) => child.stdout.write(`${JSON.stringify(message)}\n`) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a failing event handler never escapes into Main, is logged, and later messages still work", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "host-client-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logFile = join(dir, "host.log");
  const { child, spawnImpl, say } = fakeHost();
  const seen = [];
  const client = createHostClient({
    spawnImpl,
    hostPi: undefined,
    logFile,
    onEvent: (event) => {
      seen.push(event.n);
      if (event.n === 1) throw new TypeError("handler exploded");
    },
    onExit: () => {
      throw new Error("exit handler exploded");
    },
  });
  const reply = client.request("list");
  // An exception thrown here would be an uncaught exception in the process that owns the socket.
  process.once("uncaughtException", (error) => assert.fail(`escaped: ${error.message}`));
  say({ event: "result", n: 1 });
  say({ event: "result", n: 2 });
  say({ id: 1, ok: true, result: { crews: [] } });
  assert.deepEqual(await reply, { crews: [] });
  await tick();
  assert.deepEqual(seen, [1, 2], "the next event is still handled");
  child.emit("exit", 0, null);
  await tick();
  process.removeAllListeners("uncaughtException");
  const log = readFileSync(logFile, "utf8");
  assert.match(log, /event handler failed: TypeError: handler exploded/);
  assert.match(log, /exit handler failed: Error: exit handler exploded/);
});
