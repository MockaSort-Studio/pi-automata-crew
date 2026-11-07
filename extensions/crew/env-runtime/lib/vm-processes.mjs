import { execFileSync } from "node:child_process";

// Pure helpers over `ps`, shared by the VM owner, the guardian and the orphan reaper. A process is only
// ever signalled when its pid, start time and command all still match what was recorded, so a recycled
// pid can never take down an unrelated process.
export const VMM_COMMAND = /qemu-system|gondolin-krun/;
const ROW = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]{8} \d{4})\s+(.*)$/;

export function parseProcesses(text) {
  return String(text)
    .split("\n")
    .map((line) => ROW.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, start, command]) => ({ pid: Number(pid), ppid: Number(ppid), start, command }));
}

export const listProcesses = (exec = execFileSync) =>
  parseProcesses(
    exec("ps", ["-axo", "pid=,ppid=,lstart=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
  );

export const vmmChildrenOf = (ownerPid, processes) =>
  processes.filter((item) => item.ppid === ownerPid && VMM_COMMAND.test(item.command));

export const isSameProcess = (entry, processes) =>
  processes.some((item) => item.pid === entry.pid && item.start === entry.start && VMM_COMMAND.test(item.command));

export function killVerified(entries, processes, kill = process.kill.bind(process)) {
  const killed = [];
  for (const entry of entries)
    if (isSameProcess(entry, processes))
      try {
        kill(entry.pid, "SIGKILL");
        killed.push(entry.pid);
      } catch {}
  return killed;
}

// Without a recorded start time the owner is judged by pid alone, which can only err towards "alive".
export const ownerIsAlive = (owner, processes) =>
  processes.some((item) => item.pid === owner.pid && (!owner.start || item.start === owner.start));
