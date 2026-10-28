import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// One small file per launched lifecycle-server.mjs process, keyed by its own
// PID, recording the host Main-session PID that spawned it. This is the
// durable owner record a later, unrelated session needs: it has no entry in
// its own in-memory Runtime/#agents map for a Lifecycle server a *previous*
// session started, but it can still find that server here and reap it if
// its recorded host process is gone.
//
// Deliberately one file per owner instead of one shared JSON array: concurrent
// Runtime instances in the same cwd (see runtime-cleanup.test.mjs) each only
// ever read or write their own PID's file, so no read-modify-write race is
// possible between them.
const ownerDir = (cwd) => join(cwd, ".pi", "runtime", "lifecycle-owners");

export async function recordOwner(cwd, { pid, hostPid, port }) {
  const dir = ownerDir(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${pid}.json`), JSON.stringify({ pid, hostPid, port, startedAt: Date.now() }));
}

export async function removeOwner(cwd, pid) {
  await rm(join(ownerDir(cwd), `${pid}.json`), { force: true });
}

export async function listOwners(cwd) {
  const dir = ownerDir(cwd);
  const names = await readdir(dir).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) =>
        readFile(join(dir, name), "utf8")
          .then((text) => JSON.parse(text))
          .catch(() => null),
      ),
  );
  return records.filter(Boolean);
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killOrphan(pid) {
  if (!isAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (isAlive(pid))
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
}

// Best-effort: reap every owner record whose recorded host process is no
// longer alive. Never touches a record whose host is still running, even if
// that host belongs to a different, still-active session in this cwd.
export async function reapOrphans(cwd) {
  const owners = await listOwners(cwd);
  const reaped = [];
  for (const owner of owners) {
    if (isAlive(owner.hostPid)) continue;
    await killOrphan(owner.pid);
    await removeOwner(cwd, owner.pid);
    reaped.push(owner);
  }
  return reaped;
}
