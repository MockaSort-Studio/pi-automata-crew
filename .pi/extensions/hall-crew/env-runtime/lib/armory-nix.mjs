import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { armoryCache, readCatalogSuite } from "./armory-artifacts.mjs";
import { validateArmorySuite } from "./armory-manifest.mjs";

// Everything Armory needs from Nix on the client: finding `nix`, fetching a published
// closure by store path, rooting it so garbage collection cannot delete it, and turning
// the catalog's suite requests into mountable closures. Suites come only from the release.
const exec = promisify(execFile);
const DEFAULT_PROFILE_NIX = "/nix/var/nix/profiles/default/bin/nix";

// Nix installers add their profile to interactive shell setup only, so a Pi process
// started elsewhere may not have `nix` on PATH. Prefer PATH, then the standard location.
export function nixBinary({
  onPath = () => spawnSync("nix", ["--version"], { stdio: "ignore" }).status === 0,
  exists = existsSync,
} = {}) {
  if (onPath()) return "nix";
  return exists(DEFAULT_PROFILE_NIX) ? DEFAULT_PROFILE_NIX : "nix";
}

// The guest is a Linux VM of the host's architecture, so artifacts are selected for that
// Nix system even when the host itself is macOS.
export const guestNixSystem = (arch = process.arch) => (arch === "arm64" ? "aarch64-linux" : "x86_64-linux");

// Garbage collection deletes any store path without a root. A closure is costly to fetch
// cold, so each is rooted here, one link per suite and system; a newer revision overwrites
// the link, so older closures become collectable.
export const armoryRootsDir = (home = homedir()) => join(home, ".cache", "hall", "armory", "roots");
export const armoryRoot = (suite, system = guestNixSystem(), home) =>
  join(armoryRootsDir(home), `${String(suite).replaceAll("/", "_")}-${system}`);

// A machine without the Armory cache fails with an opaque Nix error; say what to do instead.
async function cacheConfigured() {
  const { stdout } = await exec(nixBinary(), ["config", "show", "substituters"]);
  return stdout.includes(armoryCache.substituter);
}

export async function explainMissingCache(error, { configured = cacheConfigured } = {}) {
  if (await configured().catch(() => true)) return error;
  const lines = [error?.stderr, error?.message].flatMap((text) => String(text ?? "").split("\n"));
  const reason = lines.find((line) => /Reason:/.test(line))?.trim() ?? lines.find((line) => line.trim())?.trim() ?? "unknown";
  return new Error(`Armory cache not configured (run scripts/setup-env.sh); ${reason}`);
}

// Fetch by store path: no flake evaluation, and `nix copy` asks the cache directly, so the
// daemon's cached misses do not apply. Nix verifies signatures; the installed closure is
// also checked against the hashes the catalog promised before it is rooted.
export async function fetchPublishedClosure({ artifact, cache, gcRoot, execute = exec }) {
  const nix = nixBinary();
  await execute(nix, ["copy", "--from", cache.substituter, artifact.storePath]);
  const { stdout } = await execute(nix, ["path-info", "-r", "--json", "--json-format", "1", artifact.storePath]);
  const installed = JSON.parse(stdout);
  const expected = artifact.closure.map((item) => item.path).sort();
  if (JSON.stringify(Object.keys(installed).sort()) !== JSON.stringify(expected))
    throw new Error("Installed closure differs from the published Armory catalog");
  const changed = artifact.closure.find((item) => installed[item.path]?.narHash !== item.narHash);
  if (changed) throw new Error(`Content of ${changed.path} differs from the published Armory catalog`);
  await mkdir(dirname(gcRoot), { recursive: true });
  await execute(nix, ["build", "--out-link", gcRoot, "--print-out-paths", artifact.storePath]);
  return { rootPath: artifact.storePath, paths: expected };
}

function catalogEntry(catalog, suite) {
  if (catalog?.format !== "hall.armory/v1" || !Array.isArray(catalog.lockers)) throw new Error("Unsupported Armory catalog format");
  const [locker, extension] = String(suite).split("/");
  const entry = catalog.lockers.find((item) => item.name === locker)?.suites?.find((item) => item.extension === extension);
  if (!entry?.manifest) throw new Error(`Armory suite is not cataloged: ${suite}`);
  return entry;
}

// Fetches one suite's published closure for this guest system. A suite the release does not
// carry for this system is an error the caller degrades from.
export async function acquireNixGuestSuite({ catalog, request, readSuite = readCatalogSuite, fetchPublished = fetchPublishedClosure }) {
  if (!request?.suite) throw new Error("Nix guest suite request requires a suite");
  const entry = catalogEntry(catalog.catalog, request.suite);
  const suite = validateArmorySuite(await readSuite(catalog, entry.manifest), request.tools);
  const system = guestNixSystem();
  const published = catalog.artifacts?.[request.suite]?.[system];
  if (!published) throw new Error(`The Armory release has no ${system} artifact for ${request.suite}`);
  const artifact = await fetchPublished({ artifact: published, cache: armoryCache, gcRoot: armoryRoot(request.suite) });
  return { suite: request.suite, tools: suite.tools, network: suite.network, rootPath: artifact.rootPath, paths: artifact.paths };
}

export async function resolveNixGuestSuiteRequests({ catalog, requests, readSuite = readCatalogSuite }) {
  if (!Array.isArray(requests)) throw new Error("Nix guest suite requests must be an array");
  const grouped = new Map();
  for (const request of requests) {
    if (!request?.suite || !Array.isArray(request.tools) || request.tools.some((tool) => typeof tool !== "string" || !tool))
      throw new Error("Nix guest suite requests require a suite and operations");
    grouped.set(request.suite, new Set([...(grouped.get(request.suite) ?? []), ...request.tools]));
  }
  return Promise.all(
    [...grouped].map(async ([suite, tools]) => {
      const manifest = validateArmorySuite(await readSuite(catalog, catalogEntry(catalog.catalog, suite).manifest), [...tools]);
      return { suite, tools: manifest.tools };
    }),
  );
}

export async function acquireNixGuestSuites({ catalog, requests, readSuite = readCatalogSuite, fetchPublished }) {
  const resolved = await resolveNixGuestSuiteRequests({ catalog, requests, readSuite });
  return Promise.all(resolved.map((request) => acquireNixGuestSuite({ catalog, request, readSuite, fetchPublished })));
}
