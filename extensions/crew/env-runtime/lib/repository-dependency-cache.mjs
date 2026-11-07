import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const FORMAT = "pi-crew-repository-dependency-cache/v3";
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const validProfile = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value);

export const dependencyCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "dependencies");
export const dependencyCacheKey = (lockfile, profile) => {
  if (!validProfile(profile)) throw new Error("Repository dependency cache requires a valid guest profile");
  return createHash("sha256")
    .update(readFileSync(lockfile))
    .update("\0")
    .update(profile)
    .update("\0")
    .update(FORMAT)
    .digest("hex");
};
export const dependencyCacheDirectory = (key, home) => join(dependencyCacheRoot(home), key);

// Preserve npm's relative symlinks and verify executable paths before publishing.
export function copyDependencyCacheModules(source, destination) {
  cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
  const root = resolve(destination);
  const check = (path) => {
    let pending = [relative(root, path)];
    let current = root;
    let followed = 0;
    try {
      while (pending.length) {
        const parts = pending.shift().split(sep).filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
          current = resolve(current, parts[i]);
          const rel = relative(root, current);
          if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("outside cache");
          if (lstatSync(current).isSymbolicLink()) {
            const target = readlinkSync(current);
            if (isAbsolute(target) || ++followed > 40) throw new Error("absolute or cyclic link");
            pending.unshift(target, parts.slice(i + 1).join(sep));
            current = dirname(current);
            break;
          }
        }
      }
    } catch (error) {
      throw new Error(`Invalid dependency cache executable link ${path}: ${error.message}`);
    }
  };
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (directory.endsWith(`${sep}.bin`)) check(path);
      if (entry.isDirectory()) visit(path);
    }
  };
  visit(root);
}

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
