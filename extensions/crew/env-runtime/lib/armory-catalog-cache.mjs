import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The last Armory release catalog this machine validated, kept so a launch survives a slow or failing
// download. A cached catalog is untrusted input like any other: it is re-validated on every read, and the
// extension source bundles it names are still verified against their pinned hash when they are used.
// "latest" is the newest catalog seen; "<revision>" is a release's own catalog, which never changes.
export const catalogCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "armory-catalog");
const fileFor = (name, home) => join(catalogCacheRoot(home), `${name}.json`);

export function readCachedCatalog(name, { home, validate }) {
  try {
    const { fetchedAt, doc } = JSON.parse(readFileSync(fileFor(name, home), "utf8"));
    const valid = validate(doc);
    if (name !== "latest" && valid.revision !== name) return undefined;
    return { doc: valid, fetchedAt };
  } catch {
    return undefined;
  }
}

// Best effort by design: failing to cache must never fail a launch.
export function writeCachedCatalog(doc, { home, now = () => new Date() } = {}) {
  try {
    mkdirSync(catalogCacheRoot(home), { recursive: true, mode: 0o700 });
    const body = JSON.stringify({ fetchedAt: now().toISOString(), doc });
    for (const name of ["latest", doc.revision]) {
      const path = fileFor(name, home);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, body, { mode: 0o600 });
      renameSync(temporary, path);
    }
    return true;
  } catch {
    return false;
  }
}
