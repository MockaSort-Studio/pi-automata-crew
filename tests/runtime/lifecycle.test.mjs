import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtempSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { LifecycleController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-controller.mjs";
import { connectLifecycle } from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-client.mjs";

const serverPath = new URL("../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-server.mjs", import.meta.url).pathname;
const waitForPort = async (child) => {
  const [data] = await once(child.stdout, "data");
  return JSON.parse(String(data)).port;
};
const stop = async (child) => {
  if (child.exitCode === null) child.kill("SIGTERM");
  await once(child, "exit");
};

test("lifecycle spawn failure removes its provisional run directory", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-failure-"));
  const id = "failed-actor";
  try {
    const controller = new LifecycleController({ cwd, sdkModule: "unused", workerModule: "unused" });
    await assert.rejects(controller.spawn({ actorId: id, name: "test", task: "test" }));
    assert.equal(existsSync(join(cwd, ".pi", "runtime", "runs", id)), false);
    assert.deepEqual(await controller.list(), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("lifecycle shutdown terminates connected clients", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-shutdown-"));
  const child = spawn(process.execPath, [serverPath, JSON.stringify({ cwd, workerModule: "unused" })], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let socket;
  try {
    const port = await waitForPort(child);
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(socket, "open");
    const closed = once(socket, "close");
    child.kill("SIGTERM");
    await Promise.all([once(child, "exit"), closed]);
    assert.equal(socket.readyState, WebSocket.CLOSED);
  } finally {
    socket?.terminate();
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("lifecycle RPC returns results and protocol errors", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-rpc-"));
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  const child = spawn(
    process.execPath,
    [serverPath, JSON.stringify({ cwd, sdkModule: "unused", workerModule: "unused" })],
    {
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  try {
    const port = await waitForPort(child);
    const url = `ws://127.0.0.1:${port}`;
    const client = await connectLifecycle(url);
    assert.deepEqual(await client.list(), []);
    assert.deepEqual(await client.inspect("missing"), { id: "missing", found: false });
    client.close();
    const socket = new WebSocket(url);
    await once(socket, "open");
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: "bad", method: "lifecycle.unknown" }));
    const [raw] = await once(socket, "message");
    const response = JSON.parse(String(raw));
    assert.equal(response.id, "bad");
    assert.match(response.error.message, /Unknown Lifecycle method/);
    socket.close();
  } finally {
    await stop(child);
    rmSync(cwd, { recursive: true, force: true });
  }
});
