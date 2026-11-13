import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requiredQemuBinary } from "../../extensions/crew/env-runtime/lib/sandbox-preflight.mjs";
import { chooseVmm } from "../../extensions/crew/env-runtime/lib/guest-vmm.mjs";
import { listProcesses, vmmChildrenOf } from "../../extensions/crew/env-runtime/lib/vm-processes.mjs";
import { createEnvironment } from "../../extensions/crew/runner/environment.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

const available = {
  qemu: () => spawnSync(requiredQemuBinary(), ["--version"], { stdio: "ignore" }).status === 0,
  krun: () => chooseVmm({ env: {} }) === "krun",
};
const vmms = () => vmmChildrenOf(process.pid, listProcesses()).length;
const echo = (environment) => environment.withVm(async (vm) => (await vm.exec("echo hello-from-guest")).stdout);

for (const vmm of ["krun", "qemu"]) {
  test(
    `${vmm}: an idle environment releases its VM and boots a fresh one on the next use`,
    { timeout: 120_000 },
    async (t) => {
      if (skipLiveGondolin(t)) return;
      if (!available[vmm]()) return t.skip(`${vmm} is unavailable here`);
      const cwd = mkdtempSync(join(tmpdir(), "env-idle-"));
      const environment = createEnvironment({ localCwd: cwd, label: "idle-test", idleMs: 400, vmm });
      t.after(async () => {
        await environment.close();
        rmSync(cwd, { recursive: true, force: true });
      });
      assert.match(await echo(environment), /hello-from-guest/);
      assert.equal(environment.isRunning(), true);
      assert.equal(vmms(), 1, "one VM while in use");
      environment.armIdle();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      assert.equal(environment.isRunning(), false, "released after idling");
      assert.equal(vmms(), 0, "no VM process remains after the release");
      assert.match(await echo(environment), /hello-from-guest/, "the next use boots a fresh VM");
      assert.equal(vmms(), 1);
      await environment.close();
      assert.equal(vmms(), 0, "closing leaves nothing behind");
    },
  );
}
