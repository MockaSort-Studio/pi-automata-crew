import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requiredQemuBinary } from "../../.pi/extensions/hall-crew/env-runtime/lib/sandbox-preflight.mjs";
import { chooseVmm } from "../../.pi/extensions/hall-crew/env-runtime/lib/guest-vmm.mjs";

const extension = new URL("../../.pi/extensions/hall-crew/env-runtime/lib/worker-gondolin-extension.mjs", import.meta.url).pathname;
const available = {
  qemu: () => spawnSync(requiredQemuBinary(), ["--version"], { stdio: "ignore" }).status === 0,
  krun: () => chooseVmm({ env: {} }) === "krun",
};

function rpcBash(cwd, vmm) {
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--no-extensions", "--extension", extension], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, HALL_VMM: vmm },
  });
  let output = "";
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Pi Gondolin smoke timed out")), 90_000);
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output
        .split("\n")
        .find((value) => value.includes('"id":"smoke"') && value.includes('"command":"bash"'));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line));
    });
  });
  child.stdin.write(`${JSON.stringify({ id: "smoke", type: "bash", command: "pwd" })}\n`);
  return { child, response };
}

for (const vmm of ["krun", "qemu"]) {
  test(`${vmm}: the registered Gondolin worker extension routes Pi's built-in bash through the guest`, { timeout: 100_000 }, async (t) => {
    if (!available[vmm]()) return t.skip(`${vmm} is unavailable here`);
    const cwd = mkdtempSync(join(tmpdir(), "gondolin-worker-smoke-"));
    const { child, response } = rpcBash(cwd, vmm);
    t.after(() => {
      child.kill("SIGTERM");
      rmSync(cwd, { recursive: true, force: true });
    });
    const result = await response;
    assert.equal(result.success, true, JSON.stringify(result));
    assert.match(result.data.output, /^\/workspace\/?\s*$/);
  });
}
