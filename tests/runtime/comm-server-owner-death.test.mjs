import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import test from "node:test";

const server = new URL("../../.pi/extensions/hall-crew/crew-runtime/lib/comm-server.mjs", import.meta.url).pathname;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("a Comm server exits once the Main process that owns it is gone", async () => {
  // A throwaway "Main" that we can kill without touching the test runner.
  const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const comm = spawn(process.execPath, [server, JSON.stringify({ adapters: [], hostPid: owner.pid })], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    await new Promise((resolve) => comm.stdout.once("data", resolve));
    assert.ok(alive(comm.pid), "the server runs while its owner lives");
    owner.kill("SIGKILL");
    const deadline = Date.now() + 5_000;
    while (alive(comm.pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(alive(comm.pid), false, "an orphaned Comm server must not outlive its owner");
  } finally {
    owner.kill("SIGKILL");
    comm.kill("SIGKILL");
  }
});
