import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import {
  isAlive,
  listOwners,
  reapOrphans,
  recordOwner,
  removeOwner,
} from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-registry.mjs";

const spawnSleeper = () => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
const deadPid = async () => {
  const child = spawnSleeper();
  await once(child, "spawn");
  child.kill("SIGKILL");
  await once(child, "exit");
  return child.pid;
};

test("recordOwner/listOwners/removeOwner round-trip one owner file per PID", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-registry-"));
  try {
    await recordOwner(cwd, { pid: 111, hostPid: 222, port: 4444 });
    const owners = await listOwners(cwd);
    assert.equal(owners.length, 1);
    assert.equal(owners[0].pid, 111);
    assert.equal(owners[0].hostPid, 222);
    await removeOwner(cwd, 111);
    assert.deepEqual(await listOwners(cwd), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("listOwners returns an empty list when no registry directory exists yet", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-registry-"));
  try {
    assert.deepEqual(await listOwners(cwd), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("reapOrphans kills and removes an owner record whose host process is gone", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-registry-"));
  const orphan = spawnSleeper();
  try {
    await once(orphan, "spawn");
    const goneHostPid = await deadPid();
    await recordOwner(cwd, { pid: orphan.pid, hostPid: goneHostPid, port: 4444 });
    const reaped = await reapOrphans(cwd);
    assert.equal(reaped.length, 1);
    assert.equal(reaped[0].pid, orphan.pid);
    assert.deepEqual(await listOwners(cwd), []);
    assert.equal(isAlive(orphan.pid), false);
  } finally {
    if (isAlive(orphan.pid)) orphan.kill("SIGKILL");
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("reapOrphans leaves a record alone whose host process is still alive", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-registry-"));
  try {
    await recordOwner(cwd, { pid: 99999, hostPid: process.pid, port: 4444 });
    const reaped = await reapOrphans(cwd);
    assert.deepEqual(reaped, []);
    const owners = await listOwners(cwd);
    assert.equal(owners.length, 1);
    assert.equal(owners[0].pid, 99999);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
