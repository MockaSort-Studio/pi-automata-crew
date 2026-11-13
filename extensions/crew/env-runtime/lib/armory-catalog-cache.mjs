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
import { dirname, join, parse } from "node:path";

export const catalogCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "armory-catalog");
const CATALOG = ["armory-catalog"];
const CACHE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The canonical path of ~/.cache/pi-crew/<components...>, or false when it cannot be trusted: every ancestor of the
// canonical home must be a directory owned by root or this account, and the home and every cache component must
// be a real (not symlinked) directory owned by this account; none may be group- or world-writable.
// Owned, non-writable ancestors exclude other accounts; same-account races are outside this boundary.
export function safeCacheDirectory({ home = homedir(), uid, create = false, components }) {
  if (typeof uid !== "function" || typeof constants.O_NOFOLLOW !== "number") return false;
  if (!Array.isArray(components) || !components.length || !components.every((part) => CACHE_COMPONENT.test(part)))
    return false;
  const owner = uid();
  if (!Number.isInteger(owner) || owner < 0) return false;
  const canonicalHome = realpathSync(home);
  let ancestor = dirname(canonicalHome);
  while (true) {
    const stat = lstatSync(ancestor);
    if (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== owner) || (stat.mode & 0o022) !== 0) return false;
    if (ancestor === parse(ancestor).root) break;
    ancestor = dirname(ancestor);
  }
  let path = canonicalHome;
  for (const component of [undefined, ".cache", "pi-crew", ...components]) {
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
  return path;
}

// A regular file this account owns and nobody else can write, opened without following a symlink; its bytes are
// read from the same descriptor that was checked. Undefined otherwise.
export function readOwnedFile(path, owner) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== owner || (stat.mode & 0o022) !== 0) return undefined;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Atomic replace through an unpredictable, exclusively created (never followed) temporary file.
export function writeOwnedFile(path, body, random = randomBytes) {
  const temporary = `${path}.${random(16).toString("hex")}.tmp`;
  writeFileSync(temporary, body, { mode: 0o600, flag: "wx" });
  try {
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
}

export function readCachedCatalog(name, { home, validate, uid = process.getuid } = {}) {
  try {
    const directory = safeCacheDirectory({ home, uid, components: CATALOG });
    if (!directory) return undefined;
    const body = readOwnedFile(join(directory, `${name}.json`), uid());
    if (!body) return undefined;
    const { fetchedAt, doc } = JSON.parse(body.toString("utf8"));
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
  try {
    const directory = safeCacheDirectory({ home, uid, create: true, components: CATALOG });
    if (!directory) return false;
    const body = JSON.stringify({ fetchedAt: now().toISOString(), doc });
    for (const name of latest ? ["latest", doc.revision] : [doc.revision])
      writeOwnedFile(join(directory, `${name}.json`), body, random);
    return true;
  } catch {
    return false;
  }
}
