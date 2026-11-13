import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_SOURCE_BYTES } from "../env-runtime/lib/armory-artifacts.mjs";
import { readOwnedFile, safeCacheDirectory, writeOwnedFile } from "../env-runtime/lib/armory-catalog-cache.mjs";

const REPOSITORY = "MockaSort-Studio/hall-armory";
const SOURCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/;
export const sourceCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "armory-src");
export const sourceUrl = (revision, file) =>
  `https://github.com/${REPOSITORY}/releases/download/armory-${revision}/${file}`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const privateCopies = new Set();
let cleanupRegistered = false;

// The verified bytes, never a checked path, are what gets loaded: they are written from memory into a fresh
// private directory (mkdtemp, 0700) with an exclusive create. Its parent is under the same checked owner-only
// cache hierarchy, not TMPDIR, so another account cannot replace the directory before import. This account (or
// root) can, which is outside this boundary: code running as the user can already replace the extension itself.
// A copy lives only for the instant of an import; one older than this was left by a crashed host.
const STALE_IMPORT_MS = 60 * 60 * 1000;
function reclaimStaleImports(parent, owner, now = Date.now()) {
  try {
    for (const name of readdirSync(parent)) {
      if (!name.startsWith("import-")) continue;
      const path = join(parent, name);
      const stat = lstatSync(path);
      if (stat.isDirectory() && stat.uid === owner && now - stat.mtimeMs > STALE_IMPORT_MS)
        rmSync(path, { recursive: true, force: true });
    }
  } catch {}
}

function privateCopy(bytes, file, { home, uid }) {
  const parent = safeCacheDirectory({ home, uid, create: true, components: ["armory-imports"] });
  if (!parent) throw new Error("Crew's private Armory import directory is unsafe");
  reclaimStaleImports(parent, uid());
  const directory = mkdtempSync(join(parent, "import-"));
  privateCopies.add(directory);
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.once("exit", () => {
      for (const dir of privateCopies) rmSync(dir, { recursive: true, force: true });
    });
  }
  const path = join(directory, file);
  writeFileSync(path, bytes, { mode: 0o400, flag: "wx" });
  return path;
}

// Removes a private copy once it has been imported. Paths this module did not create are left alone.
export function discardPrivateCopy(path) {
  const directory = dirname(String(path));
  if (!privateCopies.delete(directory)) return false;
  rmSync(directory, { recursive: true, force: true });
  return true;
}

function cachedBytes(source, { home, uid }) {
  try {
    const directory = safeCacheDirectory({ home, uid, components: ["armory-src", source.sha256] });
    if (!directory) return undefined;
    const bytes = readOwnedFile(join(directory, source.file), uid());
    return bytes && bytes.length === source.size && sha256(bytes) === source.sha256 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

// Caching is best effort: an untrusted or unwritable cache directory only costs a download.
function cacheBytes(source, bytes, { home, uid, random }) {
  try {
    const directory = safeCacheDirectory({ home, uid, create: true, components: ["armory-src", source.sha256] });
    if (directory) writeOwnedFile(join(directory, source.file), bytes, random);
  } catch {}
}

// Returns the path of a private copy of a suite's extension source bundle, fetched from the release the catalog
// names and verified against the hash the catalog pins. The URL is built here from the release revision and the
// file name; the catalog contributes only the name, the size and the hash, so a catalog cannot point a client at
// another host. The cache is content-addressed, read only from directories and files this account owns and nobody
// else can write (no symlinks followed), and re-verified on every use; a tampered or truncated file is fetched
// again, never loaded. Pass the returned path to `loadSuiteModule`, which discards the copy after import.
export async function fetchSuiteExtension({
  catalog,
  suiteId,
  home,
  fetchImpl = fetch,
  uid = process.getuid,
  random = randomBytes,
}) {
  const source = catalog?.sources?.[suiteId];
  if (!source) throw new Error(`The Armory release has no extension source for ${suiteId}`);
  if (
    !SOURCE_FILE.test(source.file ?? "") ||
    !/^[0-9a-f]{64}$/.test(source.sha256 ?? "") ||
    !Number.isInteger(source.size) ||
    source.size <= 0 ||
    source.size > MAX_SOURCE_BYTES
  )
    throw new Error(`Armory extension source for ${suiteId} has a malformed entry`);
  const cached = cachedBytes(source, { home, uid });
  if (cached) return privateCopy(cached, source.file, { home, uid });
  const response = await fetchImpl(sourceUrl(catalog.revision, source.file), {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Armory extension source unavailable (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES || bytes.length !== source.size)
    throw new Error(`Armory extension source for ${suiteId} has an unexpected size`);
  if (sha256(bytes) !== source.sha256)
    throw new Error(`Armory extension source for ${suiteId} does not match its pinned hash`);
  cacheBytes(source, bytes, { home, uid, random });
  return privateCopy(bytes, source.file, { home, uid });
}
