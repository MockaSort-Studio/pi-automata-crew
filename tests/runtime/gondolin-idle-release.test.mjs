import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { requiredQemuBinary } from "../../.pi/extensions/hall-crew/env-runtime/lib/sandbox-preflight.mjs";
import { chooseVmm } from "../../.pi/extensions/hall-crew/env-runtime/lib/guest-vmm.mjs";

const extension = new URL("../../.pi/extensions/hall-crew/env-runtime/lib/worker-gondolin-extension.mjs", import.meta.url).href;
const available = {
  qemu: () => spawnSync(requiredQemuBinary(), ["--version"], { stdio: "ignore" }).status === 0,
  krun: () => chooseVmm({ env: {} }) === "krun",
};

// Runs in a child with no inherited fd 3 so the credential-lease lookup is the standalone path.
const script = `
import { execFileSync } from "node:child_process";
process.env.HALL_VM_IDLE_MS = "400";
const { default: extension } = await import(${JSON.stringify(extension)});
const tools = new Map(), handlers = new Map();
extension({ registerTool: (tool) => tools.set(tool.name, tool), on: (name, handler) => handlers.set(name, handler) });
const vmms = () => execFileSync("ps", ["-axo", "ppid=,command="], { encoding: "utf8" }).split("\\n").filter((l) => l.trim().startsWith(process.pid + " ") && /qemu-system|gondolin-krun-runner/.test(l)).length;
const run = async () => JSON.stringify((await tools.get("bash").execute("call", { command: "echo hello-from-guest" })).content);
const out = {};
await handlers.get("session_start")();
out.first = (await run()).includes("hello-from-guest");
out.vmmsWhileActive = vmms();
await handlers.get("agent_settled")();
await new Promise((resolve) => setTimeout(resolve, 2000));
out.vmmsAfterIdle = vmms();
out.again = (await run()).includes("hello-from-guest");
out.vmmsAfterReboot = vmms();
await handlers.get("session_shutdown")({ reason: "quit" });
await new Promise((resolve) => setTimeout(resolve, 500));
out.vmmsAfterQuit = vmms();
console.log(JSON.stringify(out));
process.exit(0);
`;

for (const vmm of ["krun", "qemu"]) {
  test(`${vmm}: an idle worker releases its VM and boots a fresh one on the next tool call`, { timeout: 120_000 }, (t) => {
    if (!available[vmm]()) return t.skip(`${vmm} is unavailable here`);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HALL_VMM: vmm },
      timeout: 100_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.deepEqual(out, { first: true, vmmsWhileActive: 1, vmmsAfterIdle: 0, again: true, vmmsAfterReboot: 1, vmmsAfterQuit: 0 });
  });
}
