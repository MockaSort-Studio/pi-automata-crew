import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MAX_SOURCE_BYTES } from "../env-runtime/lib/armory-artifacts.mjs";

const REPOSITORY = "MockaSort-Studio/hall-armory";
export const sourceCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "armory-src");
export const sourceUrl = (revision, file) =>
  `https://github.com/${REPOSITORY}/releases/download/armory-${revision}/${file}`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Returns the path of a suite's extension source bundle, fetched from the release the catalog names and
// verified against the hash the catalog pins. The URL is built here from the release revision and the file
// name; the catalog contributes only the name, the size and the hash, so a catalog cannot point a client at
// another host. The cache is content-addressed and re-verified on every use, so a tampered or truncated
// file is fetched again, never loaded.
export async function fetchSuiteExtension({ catalog, suiteId, home, fetchImpl = fetch }) {
  const source = catalog?.sources?.[suiteId];
  if (!source) throw new Error(`The Armory release has no extension source for ${suiteId}`);
  const directory = join(sourceCacheRoot(home), source.sha256);
  const path = join(directory, source.file);
  try {
    if (sha256(readFileSync(path)) === source.sha256) return path;
  } catch {}
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
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { mode: 0o600 });
  renameSync(temporary, path);
  return path;
}
