import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const catalogCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "armory-catalog");
const fileFor = (name, home) => join(catalogCacheRoot(home), `${name}.json`);

// Owned, non-writable ancestors exclude other accounts; same-account races are outside this boundary.
function safeDirectory(home = homedir(), uid, create = false) {
  if (typeof uid !== "function" || typeof constants.O_NOFOLLOW !== "number") return false;
  const owner = uid();
  if (!Number.isInteger(owner) || owner < 0) return false;
  let path = realpathSync(home);
  for (const component of [undefined, ".cache", "pi-crew", "armory-catalog"]) {
    if (component) {
      path = join(path, component);
      if (create) {
        try {
          mkdirSync(path, { mode: 0o700 });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
    }
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.uid !== owner || (stat.mode & 0o022) !== 0) return false;
  }
  return true;
}

export function readCachedCatalog(name, { home, validate, uid = process.getuid } = {}) {
  try {
    if (!safeDirectory(home, uid)) return undefined;
    const fd = openSync(fileFor(name, home), constants.O_RDONLY | constants.O_NOFOLLOW);
    let body;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.uid !== uid() || (stat.mode & 0o022) !== 0) return undefined;
      body = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
    const { fetchedAt, doc } = JSON.parse(body);
    const valid = validate(doc);
    if (name !== "latest" && valid.revision !== name) return undefined;
    return { doc: valid, fetchedAt };
  } catch {
    return undefined;
  }
}

// Caching is best effort and never prevents a launch.
export function writeCachedCatalog(
  doc,
  { home, now = () => new Date(), uid = process.getuid, latest = true, random = randomBytes } = {},
) {
  let temporary;
  let created = false;
  try {
    if (!safeDirectory(home, uid, true)) return false;
    const body = JSON.stringify({ fetchedAt: now().toISOString(), doc });
    for (const name of latest ? ["latest", doc.revision] : [doc.revision]) {
      const path = fileFor(name, home);
      temporary = `${path}.${random(16).toString("hex")}.tmp`;
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
