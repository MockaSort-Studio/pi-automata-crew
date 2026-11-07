import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reapOrphanVms, vmRegistryDir } from "../../extensions/crew/env-runtime/lib/vm-lifecycle.mjs";
import {
  killVerified,
  listProcesses,
  orphanedVmmsSince,
  ownerIsAlive,
  parseProcesses,
  vmmChildrenOf,
} from "../../extensions/crew/env-runtime/lib/vm-processes.mjs";
import { requiredQemuBinary } from "../../extensions/crew/env-runtime/lib/sandbox-preflight.mjs";
import { chooseVmm } from "../../extensions/crew/env-runtime/lib/guest-vmm.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

const PS = [
  "  100     1 Thu Nov  6 22:00:00 2026 /sbin/launchd",
  "  200   100 Thu Nov  6 22:01:00 2026 node owner.mjs",
  "  300   200 Thu Nov  6 22:01:05 2026 qemu-system-aarch64 -m 1G -kernel /x",
  "  400   200 Thu Nov  6 22:01:06 2026 /x/gondolin-krun-runner /tmp/c.json",
  "  500   200 Thu Nov  6 22:01:07 2026 /usr/bin/sleep 5",
].join("\n");

test("ps output is parsed and VM processes are found by owner", () => {
  const processes = parseProcesses(PS);
  assert.equal(processes.length, 5);
  assert.deepEqual(
    vmmChildrenOf(200, processes).map((item) => item.pid),
    [300, 400],
  );
  assert.deepEqual(vmmChildrenOf(100, processes), []);
});

test("a recycled pid or a different command is never signalled", () => {
  const processes = parseProcesses(PS);
  const signalled = [];
  const kill = (pid) => signalled.push(pid);
  const killed = killVerified(
    [
      { pid: 300, start: "Thu Nov  6 22:01:05 2026" },
      { pid: 400, start: "Thu Nov  6 19:00:00 2026" },
      { pid: 500, start: "Thu Nov  6 22:01:07 2026" },
      { pid: 999, start: "Thu Nov  6 22:01:07 2026" },
    ],
    processes,
    kill,
  );
  assert.deepEqual(killed, [300]);
  assert.deepEqual(signalled, [300]);
});

test("the reaper kills the VMs of a dead owner only, and forgets the record", () => {
  const home = mkdtempSync(join(tmpdir(), "vm-reap-"));
  try {
    const directory = vmRegistryDir(home);
    mkdirSync(directory, { recursive: true });
    const vmm = [{ pid: 300, start: "Thu Nov  6 22:01:05 2026" }];
    writeFileSync(join(directory, "dead.json"), JSON.stringify({ owner: { pid: 777, start: "x" }, vmms: vmm }));
    writeFileSync(
      join(directory, "alive.json"),
      JSON.stringify({
        owner: { pid: 200, start: "Thu Nov  6 22:01:00 2026" },
        vmms: [{ pid: 400, start: "Thu Nov  6 22:01:06 2026" }],
      }),
    );
    writeFileSync(join(directory, "corrupt.json"), "{");
    const signalled = [];
    const reaped = reapOrphanVms({ home, processes: parseProcesses(PS), kill: (pid) => signalled.push(pid) });
    assert.deepEqual(reaped, [300]);
    assert.deepEqual(signalled, [300]);
    assert.deepEqual(readdirSync(directory), ["alive.json"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an owner recorded without a start time is judged by pid alone", () => {
  assert.equal(ownerIsAlive({ pid: 200 }, parseProcesses(PS)), true);
  assert.equal(ownerIsAlive({ pid: 201 }, parseProcesses(PS)), false);
});

const ORPHANS = [
  "  100     1 Thu Nov  6 22:00:00 2026 /sbin/launchd",
  "  200   100 Thu Nov  6 22:01:00 2026 node owner.mjs",
  "  301     1 Thu Nov  6 22:00:30 2026 /x/gondolin-krun-runner /tmp/old.json",
  "  302     1 Thu Nov  6 22:01:02 2026 /x/gondolin-krun-runner /tmp/leak.json",
  "  303     1 Thu Nov  6 22:01:03 2026 qemu-system-aarch64 -kernel /Users/u/.pi/agent/cache/gondolin/images/k",
  "  304     1 Thu Nov  6 22:01:04 2026 qemu-system-aarch64 -kernel /home/u/vms/my-own.img",
  "  305   200 Thu Nov  6 22:01:05 2026 /x/gondolin-krun-runner /tmp/live.json",
  "  306     1 Thu Nov  6 22:01:06 2026 /usr/bin/sleep 100",
].join("\n");

test("an owner's leaked VM is recognised by being an orphaned Gondolin VM that started during its lifetime", () => {
  const owner = { pid: 200, start: "Thu Nov  6 22:01:00 2026" };
  const orphans = orphanedVmmsSince(owner, parseProcesses(ORPHANS)).map((item) => item.pid);
  assert.deepEqual(orphans, [302, 303], "not older VMs, not other QEMU, not live children, not non-VMs");
});

test("the reaper also sweeps an owner's unregistered VM that booted when it died", () => {
  const home = mkdtempSync(join(tmpdir(), "vm-reap-"));
  try {
    const directory = vmRegistryDir(home);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "dead.json"),
      JSON.stringify({ owner: { pid: 777, start: "Thu Nov  6 22:01:00 2026" }, vmms: [] }),
    );
    const signalled = [];
    const reaped = reapOrphanVms({ home, processes: parseProcesses(ORPHANS), kill: (pid) => signalled.push(pid) });
    assert.deepEqual(reaped.sort(), [302, 303]);
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const fixture = new URL("./fixtures/vm-owner.mjs", import.meta.url).pathname;
const live = [
  ["krun", () => chooseVmm({ env: {} }) === "krun"],
  ["qemu", () => spawnSync(requiredQemuBinary(), ["--version"], { stdio: "ignore" }).status === 0],
];
// Other test files boot VMs in parallel, so only the processes owned by the fixture are considered.
const ownedBy = (pid) => vmmChildrenOf(pid, listProcesses());
const stillRunning = (entries) =>
  entries.some((entry) => listProcesses().some((item) => item.pid === entry.pid && item.start === entry.start));
const waitUntil = async (condition, ms, every = 100) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  return condition();
};
const startOwner = async (vmm, home, extra = {}) => {
  const child = spawn(process.execPath, [fixture], {
    env: { ...process.env, PROBE_VMM: vmm, PROBE_HOME: home, ...extra },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  assert.ok(await waitUntil(() => output.includes("READY"), 60_000), "owner never became ready");
  return { child, output: () => output };
};

for (const [vmm, available] of live)
  test(
    `${vmm}: a VM does not outlive a SIGKILLed owner, and a closed VM leaves nothing behind`,
    { timeout: 120_000 },
    async (t) => {
      if (skipLiveGondolin(t)) return;
      if (!available()) return t.skip(`${vmm} is unavailable here`);
      const home = mkdtempSync(join(tmpdir(), "vm-live-"));
      try {
        const owner = await startOwner(vmm, home);
        const vms = ownedBy(owner.child.pid);
        assert.equal(vms.length, 1, "the owner runs exactly one VM process");
        assert.equal(readdirSync(vmRegistryDir(home)).length, 1, "the VM is registered");
        owner.child.kill("SIGKILL");
        assert.ok(await waitUntil(() => !stillRunning(vms), 10_000), "the VM process survived its owner");
        assert.ok(
          await waitUntil(
            () => !existsSync(vmRegistryDir(home)) || readdirSync(vmRegistryDir(home)).length === 0,
            5_000,
          ),
        );

        const closing = await startOwner(vmm, home, { PROBE_CLOSE: "1" });
        const closed = ownedBy(closing.child.pid);
        assert.ok(await waitUntil(() => closing.output().includes("CLOSED"), 20_000));
        assert.ok(await waitUntil(() => !stillRunning(closed), 10_000), "a closed VM left a process");
        assert.ok(
          await waitUntil(
            () => !existsSync(vmRegistryDir(home)) || readdirSync(vmRegistryDir(home)).length === 0,
            10_000,
          ),
          "the guardian removed its record",
        );
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

for (const [vmm, available] of live)
  test(`${vmm}: an owner killed while its VM is still booting leaks nothing`, { timeout: 120_000 }, async (t) => {
    if (skipLiveGondolin(t)) return;
    if (!available()) return t.skip(`${vmm} is unavailable here`);
    const home = mkdtempSync(join(tmpdir(), "vm-boot-"));
    try {
      const child = spawn(process.execPath, [fixture], {
        env: { ...process.env, PROBE_VMM: vmm, PROBE_HOME: home },
        stdio: ["ignore", "ignore", "inherit"],
      });
      // The VM's process exists well before the owner has registered it; kill the owner the moment it appears.
      let vms = [];
      assert.ok(await waitUntil(() => (vms = ownedBy(child.pid)).length > 0, 60_000, 10), "the VM process appeared");
      child.kill("SIGKILL");
      assert.ok(await waitUntil(() => !stillRunning(vms), 20_000), "a VM killed mid-boot outlived its owner");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
