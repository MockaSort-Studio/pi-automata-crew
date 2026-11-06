import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FORMAT = "pi-crew-repository-dependency-cache/v2";
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const validProfile = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value);

export const dependencyCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "dependencies");
export const dependencyCacheKey = (lockfile, profile) => {
  if (!validProfile(profile)) throw new Error("Repository dependency cache requires a valid guest profile");
  return createHash("sha256").update(readFileSync(lockfile)).update("\0").update(profile).digest("hex");
};
export const dependencyCacheDirectory = (key, home) => join(dependencyCacheRoot(home), key);

const unavailable = (key) =>
  new Error(
    `Repository dependency cache ${key} is unavailable. Build it locally with the matching guest profile before launching an implementation Crew.`,
  );

// The cache is a repository artifact, not part of the guest rootfs. Its directory
// is derived from source and a declarative guest profile, never from a worker path.
export function resolveRepositoryDependencyCache({
  cwd,
  profile,
  home,
  exists = existsSync,
  readFile = readFileSync,
  stat = statSync,
}) {
  const lockfile = join(cwd, "package-lock.json");
  if (!exists(lockfile)) throw new Error("Repository dependency cache requires package-lock.json");
  const key = dependencyCacheKey(lockfile, profile);
  const directory = dependencyCacheDirectory(key, home);
  const manifestPath = join(directory, "manifest.json");
  const modulesPath = join(directory, "node_modules");
  if (!exists(manifestPath) || !exists(modulesPath)) throw unavailable(key);
  let manifest;
  try {
    manifest = JSON.parse(readFile(manifestPath, "utf8"));
  } catch {
    throw unavailable(key);
  }
  if (
    manifest?.format !== FORMAT ||
    manifest.key !== key ||
    manifest.profile !== profile ||
    typeof manifest.runtime !== "object" ||
    typeof manifest.runtime.node !== "string" ||
    typeof manifest.runtime.machine !== "string" ||
    typeof manifest.runtime.osRelease !== "string" ||
    manifest.nodeModules !== "node_modules"
  )
    throw unavailable(key);
  if (!stat(modulesPath).isDirectory()) throw unavailable(key);
  return { key, profile, modulesPath, runtime: manifest.runtime };
}

export function workerDependencyCache(config, options) {
  const requested = config?.dependencyCache;
  if (!requested) return undefined;
  if (!HEX_SHA256.test(requested.key ?? "") || !validProfile(requested.profile))
    throw new Error("Worker dependency cache is invalid");
  const resolved = resolveRepositoryDependencyCache({ cwd: config.cwd, profile: requested.profile, ...options });
  if (resolved.key !== requested.key) throw new Error("Worker dependency cache does not match its repository lockfile");
  return resolved;
}

export async function verifyGuestDependencyCache(vm, cache) {
  const result = await vm.exec("node --version; uname -m; cat /etc/os-release");
  if (result.exitCode !== 0) throw new Error("Guest runtime fingerprint could not be read");
  const [node, machine, ...osRelease] = result.stdout.split("\n");
  const actual = { node, machine, osRelease: osRelease.filter(Boolean).join("\n") };
  if (JSON.stringify(actual) !== JSON.stringify(cache.runtime))
    throw new Error("Guest runtime does not match the repository dependency cache");
}

export const repositoryDependencyCacheFormat = FORMAT;
