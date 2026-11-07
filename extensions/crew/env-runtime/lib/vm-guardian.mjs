// Detached watchdog for VM processes. A VM owner spawns this with a stdin pipe; the kernel closes that
// pipe when the owner dies for any reason, including SIGKILL, and only then are the registered VM processes
// killed. Event-driven: no polling. Protocol (JSON lines): {"add":[{pid,start}]} and {"remove":[pid]}.
// Usage: node vm-guardian.mjs <registry-file>
import { createInterface } from "node:readline";
import { rmSync } from "node:fs";
import { killVerified, listProcesses } from "./vm-processes.mjs";

const registryFile = process.argv[2];
const tracked = new Map();
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    for (const entry of message.add ?? []) tracked.set(entry.pid, entry);
    for (const pid of message.remove ?? []) tracked.delete(pid);
  } catch {}
});
lines.on("close", () => {
  killVerified([...tracked.values()], listProcesses());
  if (registryFile) rmSync(registryFile, { force: true });
  process.exit(0);
});
