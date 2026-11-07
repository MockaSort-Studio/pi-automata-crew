import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { VM } from "@earendil-works/gondolin";
import { killVerified, listProcesses, ownerIsAlive, vmmChildrenOf } from "./vm-processes.mjs";

// A Gondolin VM's process outlives a hard-killed owner (measured: SIGKILL of the owner leaves the krun or
// qemu process running under launchd). Every VM created here is tracked in two ways: a detached guardian
// that kills it the moment the owner's pipe closes, and a registry file that lets the next start reap what
// a lost guardian could not.
export const vmRegistryDir = (home = homedir()) => join(home, ".cache", "pi-crew", "vms");

// Kills VM processes whose recorded owner is gone. Safe by construction: see vm-processes.mjs.
export function reapOrphanVms({ home, processes = listProcesses(), kill } = {}) {
  const directory = vmRegistryDir(home);
  let names = [];
  try {
    names = readdirSync(directory);
  } catch {}
  const reaped = [];
  for (const name of names) {
    const path = join(directory, name);
    try {
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (ownerIsAlive(record.owner, processes)) continue;
      reaped.push(...killVerified(record.vmms ?? [], processes, kill));
    } catch {}
    rmSync(path, { force: true });
  }
  return reaped;
}

const state = { guardian: undefined, tracked: new Map(), file: undefined, owner: undefined, reaped: false };

function persist() {
  if (!state.file) return;
  if (!state.tracked.size) return rmSync(state.file, { force: true });
  writeFileSync(state.file, JSON.stringify({ owner: state.owner, vmms: [...state.tracked.values()] }));
}

function guardianFor(home) {
  if (state.guardian && !state.guardian.killed && state.guardian.exitCode === null) return state.guardian;
  const directory = vmRegistryDir(home);
  mkdirSync(directory, { recursive: true });
  const processes = listProcesses();
  const self = processes.find((item) => item.pid === process.pid);
  state.owner = { pid: process.pid, start: self?.start };
  state.file = join(directory, `${process.pid}.json`);
  const child = spawn(process.execPath, [new URL("./vm-guardian.mjs", import.meta.url).pathname, state.file], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.unref();
  child.stdin.unref?.();
  state.guardian = child;
  return child;
}

const send = (message) => {
  try {
    state.guardian?.stdin.write(`${JSON.stringify(message)}\n`);
  } catch {}
};

// VM.create plus tracking. Gondolin boots lazily on first use, so the VM is started here: only then does its
// process exist. That process is found among this process's children, so two creations must not overlap:
// callers create one VM at a time (the runner does).
export async function createTrackedVm(options, { home } = {}) {
  if (!state.reaped) {
    state.reaped = true;
    reapOrphanVms({ home });
  }
  guardianFor(home);
  const known = new Set(vmmChildrenOf(process.pid, listProcesses()).map((item) => item.pid));
  const vm = await VM.create(options);
  await vm.start();
  const claimed = vmmChildrenOf(process.pid, listProcesses())
    .filter((item) => !known.has(item.pid))
    .map(({ pid, start }) => ({ pid, start }));
  for (const entry of claimed) state.tracked.set(entry.pid, entry);
  send({ add: claimed });
  persist();
  const close = vm.close.bind(vm);
  vm.close = async (...args) => {
    try {
      return await close(...args);
    } finally {
      for (const entry of claimed) state.tracked.delete(entry.pid);
      send({ remove: claimed.map((entry) => entry.pid) });
      persist();
    }
  };
  return vm;
}
