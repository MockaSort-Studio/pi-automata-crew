// Test fixture: a process that owns one tracked VM until it is killed.
import { MemoryProvider } from "@earendil-works/gondolin";
import { chooseVmm } from "../../../extensions/crew/env-runtime/lib/guest-vmm.mjs";
import { createTrackedVm } from "../../../extensions/crew/env-runtime/lib/vm-lifecycle.mjs";

const vm = await createTrackedVm(
  { sandbox: { vmm: process.env.PROBE_VMM || chooseVmm() }, vfs: { mounts: { "/workspace": new MemoryProvider() } } },
  { home: process.env.PROBE_HOME },
);
await vm.exec("true");
console.log("READY");
if (process.env.PROBE_CLOSE === "1") {
  await vm.close();
  console.log("CLOSED");
  process.exit(0);
}
setInterval(() => {}, 1000);
