import { readFileSync } from "node:fs";
import { readCachedCatalog, writeCachedCatalog } from "./armory-catalog-cache.mjs";

// The one binary cache this client trusts; a catalog naming any other is refused.
export const armoryCache = JSON.parse(readFileSync(new URL("../armory-cache.json", import.meta.url), "utf8"));
const ARMORY_REPOSITORY = "MockaSort-Studio/hall-armory";
const LATEST_RELEASE_URL = `https://github.com/${ARMORY_REPOSITORY}/releases/latest/download/artifacts.json`;
export const pinnedReleaseUrl = (revision) =>
  `https://github.com/${ARMORY_REPOSITORY}/releases/download/armory-${revision}/artifacts.json`;

const STORE_PATH = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/;
const NAR_HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;
const SYSTEMS = ["x86_64-linux", "aarch64-linux"];
const SOURCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/;
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

// This is the trust boundary for a downloaded catalog. It is deliberately strict
// and independent of the producer's own validation.
export function validateArtifactCatalog(doc, cache = armoryCache) {
  const fail = (message) => {
    throw new Error(`Invalid Armory artifact catalog: ${message}`);
  };
  if (doc?.format !== "hall.armory-artifacts/v1") fail("unsupported format");
  if (!/^[0-9a-f]{40}$/.test(doc.revision ?? "")) fail("revision must be a full git commit");
  // Never follow a catalog to a cache this client has not been configured to trust.
  if (doc.cache?.substituter !== cache.substituter || doc.cache?.publicKey !== cache.publicKey)
    fail("it names a different binary cache than the one pinned by this client");
  if (doc.catalog?.format !== "hall.armory/v1") fail("embedded catalog is not hall.armory/v1");
  for (const [id, suite] of Object.entries(doc.suites ?? {})) {
    if (suite.manifest?.format !== "hall.armory-suite/v1" || typeof suite.manifestPath !== "string")
      fail(`${id}: embedded manifest is missing`);
    if (suite.source !== undefined) {
      const { file, sha256, size } = suite.source;
      if (
        !SOURCE_FILE.test(file ?? "") ||
        !/^[0-9a-f]{64}$/.test(sha256 ?? "") ||
        !Number.isInteger(size) ||
        size <= 0 ||
        size > MAX_SOURCE_BYTES
      )
        fail(`${id}: bad source bundle entry`);
    }
    for (const [system, artifact] of Object.entries(suite.systems ?? {})) {
      if (!SYSTEMS.includes(system)) fail(`${id}: unknown system ${system}`);
      const closure = artifact.closure ?? [];
      const valid = closure.every((item) => STORE_PATH.test(item.path) && NAR_HASH.test(item.narHash));
      if (!STORE_PATH.test(artifact.storePath) || !NAR_HASH.test(artifact.narHash) || !valid)
        fail(`${id}/${system}: bad store path or hash`);
      if (!closure.some((item) => item.path === artifact.storePath)) fail(`${id}/${system}: closure omits its root`);
    }
  }
  return doc;
}

async function readTransport(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { redirect: "follow", signal });
  if (!response.ok) throw new Error(`Armory release unavailable (HTTP ${response.status})`);
  return response.text();
}

export async function fetchArtifactCatalog({ url = LATEST_RELEASE_URL, fetchImpl = fetch, cache } = {}) {
  const text = await readTransport(url, fetchImpl, AbortSignal.timeout(12_000));
  return validateArtifactCatalog(JSON.parse(text), cache);
}

// A catalog reference that needs no Nix to resolve: manifests are embedded and the
// artifact paths are known.
export function referenceFromArtifacts(doc) {
  return {
    revision: doc.revision,
    manifest: "manifest.json",
    catalog: doc.catalog,
    manifests: Object.fromEntries(Object.values(doc.suites).map((suite) => [suite.manifestPath, suite.manifest])),
    artifacts: Object.fromEntries(Object.entries(doc.suites).map(([id, suite]) => [id, suite.systems])),
    // Each suite's extension source bundle (file name + sha256), when the release carries one.
    sources: Object.fromEntries(
      Object.entries(doc.suites)
        .filter(([, suite]) => suite.source)
        .map(([id, suite]) => [id, suite.source]),
    ),
    release: pinnedReleaseUrl(doc.revision),
  };
}

// The release is the single source of Armory suites. A launch resolves the latest
// release; a worker re-resolves the exact release its launch pinned.
export async function resolveArmoryCatalog({
  release,
  fetchImpl = fetch,
  cache,
  home,
  attempts = 2,
  budgetMs = 12_000,
} = {}) {
  const match = typeof release === "string" && /\/armory-([0-9a-f]{40})\/artifacts\.json$/.exec(release);
  const pinned = match && release === pinnedReleaseUrl(match[1]) ? match[1] : undefined;
  const cached = (name) => {
    const hit = readCachedCatalog(name, { home, validate: (doc) => validateArtifactCatalog(doc, cache) });
    try {
      return hit && { ...referenceFromArtifacts(hit.doc), fromCache: true, cachedAt: hit.fetchedAt };
    } catch {
      return undefined;
    }
  };
  if (pinned) {
    const hit = cached(pinned);
    if (hit) return hit;
  }
  let failure;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort();
        reject(new Error("Armory release timed out"));
      },
      Math.min(12_000, Math.max(0, budgetMs)),
    );
  });
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let text;
      try {
        text = await Promise.race([
          readTransport(release ?? LATEST_RELEASE_URL, fetchImpl, controller.signal),
          timeout,
        ]);
      } catch (error) {
        failure = error;
        if (controller.signal.aborted) break;
        continue;
      }
      const doc = validateArtifactCatalog(JSON.parse(text), cache);
      if (pinned && doc.revision !== pinned) throw new Error("Armory catalog revision does not match pinned release");
      const reference = referenceFromArtifacts(doc);
      if (release === undefined || pinned) writeCachedCatalog(doc, { home, latest: release === undefined });
      return reference;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  const hit = release === undefined ? cached("latest") : undefined;
  if (hit) return hit;
  throw new Error(`${failure?.message ?? "Armory release unavailable"} (no cached Armory catalog to fall back to)`, {
    cause: failure,
  });
}

export function cachedCatalogWarning(catalog) {
  return catalog?.fromCache
    ? `Using cached Armory catalog ${catalog.revision} (cached at ${catalog.cachedAt}; possibly stale).`
    : undefined;
}

export function readCatalogSuite(reference, manifestPath) {
  if (
    typeof manifestPath !== "string" ||
    !manifestPath ||
    manifestPath.startsWith("/") ||
    manifestPath.split("/").includes("..")
  )
    throw new Error("Armory suite manifest path must be a non-escaping relative path");
  const manifest = reference.manifests?.[manifestPath];
  if (!manifest) throw new Error(`Armory suite manifest is not in the release: ${manifestPath}`);
  return structuredClone(manifest);
}
