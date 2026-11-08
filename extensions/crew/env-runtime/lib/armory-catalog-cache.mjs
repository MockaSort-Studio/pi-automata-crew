import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const catalogCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "armory-catalog");
const fileFor = (name, home) => join(catalogCacheRoot(home), `${name}.json`);

// A user whose home is writable by an attacker already controls the process. This policy
// protects against a shared or mis-permissioned cache, not a compromised account.
function safeDirectory(home, uid, create = false) {
  const root = catalogCacheRoot(home);
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  return stat.isDirectory() && stat.uid === uid() && (stat.mode & 0o022) === 0;
}

export function readCachedCatalog(name, { home, validate, uid = process.getuid } = {}) {
  try {
    if (!safeDirectory(home, uid)) return undefined;
    const { fetchedAt, doc } = JSON.parse(readFileSync(fileFor(name, home), "utf8"));
    const valid = validate(doc);
    if (name !== "latest" && valid.revision !== name) return undefined;
    return { doc: valid, fetchedAt };
  } catch {
    return undefined;
  }
}

// Caching is best effort and never prevents a launch.
export function writeCachedCatalog(doc, { home, now = () => new Date(), uid = process.getuid } = {}) {
  let temporary;
  let created = false;
  try {
    if (!safeDirectory(home, uid, true)) return false;
    const body = JSON.stringify({ fetchedAt: now().toISOString(), doc });
    for (const name of ["latest", doc.revision]) {
      const path = fileFor(name, home);
      temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
      writeFileSync(temporary, body, { mode: 0o600, flag: "wx" });
      created = true;
      renameSync(temporary, path);
      created = false;
      temporary = undefined;
    }
    return true;
  } catch {
    if (temporary && created) {
      try {
        unlinkSync(temporary);
      } catch {}
    }
    return false;
  }
}
