// Detached watchdog for VM processes. A VM owner spawns this with a stdin pipe; the kernel closes that
// pipe when the owner dies for any reason, including SIGKILL, and only then are the registered VM processes
// killed. Event-driven: no polling. Protocol (JSON lines): {"owner":{pid,start}}, {"add":[{pid,start}]} and
// {"remove":[pid]}. Beyond what was registered, an owner that dies before registering a booting VM leaves an
// orphan that is swept by its start time (see vm-processes.mjs).
// Usage: node vm-guardian.mjs <registry-file>
import { createInterface } from "node:readline";
import { rmSync } from "node:fs";
import { killVerified, listProcesses, sweepOrphanedVmms } from "./vm-processes.mjs";

const registryFile = process.argv[2];
const tracked = new Map();
let owner;
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.owner) owner = message.owner;
    for (const entry of message.add ?? []) tracked.set(entry.pid, entry);
    for (const pid of message.remove ?? []) tracked.delete(pid);
  } catch {}
});
lines.on("close", () => {
  const processes = listProcesses();
  killVerified([...tracked.values()], processes);
  sweepOrphanedVmms(owner, processes);
  if (registryFile) rmSync(registryFile, { force: true });
  process.exit(0);
});
