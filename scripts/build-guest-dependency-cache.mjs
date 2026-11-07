#!/usr/bin/env node
import { rename, rm, writeFile } from "node:fs/promises";
import { cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { RealFSProvider, VM } from "@earendil-works/gondolin";
import { createGuestNetwork } from "../extensions/crew/env-runtime/lib/guest-network.mjs";
import {
  copyDependencyCacheModules,
  dependencyCacheDirectory,
  dependencyCacheKey,
  repositoryDependencyCacheFormat,
} from "../extensions/crew/env-runtime/lib/repository-dependency-cache.mjs";

const usage = "Usage: node scripts/build-guest-dependency-cache.mjs --profile <guest-profile> [repository-directory]";
const args = process.argv.slice(2);
const profileAt = args.indexOf("--profile");
if (profileAt < 0 || !args[profileAt + 1] || args.length > 3) throw new Error(usage);
const profile = args[profileAt + 1];
const cwd = resolve(args.find((value, index) => index !== profileAt && index !== profileAt + 1) ?? process.cwd());
const packageJson = join(cwd, "package.json");
const lockfile = join(cwd, "package-lock.json");
if (!existsSync(packageJson) || !existsSync(lockfile))
  throw new Error("Guest dependency cache builder requires package.json and package-lock.json");

const key = dependencyCacheKey(lockfile, profile);
const target = dependencyCacheDirectory(key);
const parent = resolve(target, "..");
if (existsSync(target)) throw new Error(`Guest dependency cache already exists: ${target}`);
const temporary = mkdtempSync(join(tmpdir(), "pi-crew-guest-cache-"));
const build = join(temporary, "build");
mkdirSync(build, { recursive: true });
mkdirSync(parent, { recursive: true });
const staging = join(temporary, "cache");
const network = createGuestNetwork({ allowedHosts: ["registry.npmjs.org"] });
let vm;
try {
  cpSync(packageJson, join(build, "package.json"));
  cpSync(lockfile, join(build, "package-lock.json"));
  vm = await VM.create({
    httpHooks: network.httpHooks,
    env: network.env,
    vfs: { mounts: { "/build": new RealFSProvider(build) } },
    sessionLabel: `guest dependency cache ${basename(cwd)}`,
  });
  const fingerprint = await vm.exec("node --version; uname -m; cat /etc/os-release");
  if (fingerprint.exitCode !== 0) throw new Error(`Guest runtime probe failed: ${fingerprint.stderr}`);
  const [node, machine, ...osRelease] = fingerprint.stdout.split("\n");
  const installed = await vm.exec("cd /build && npm ci --ignore-scripts --no-audit --no-fund");
  if (installed.exitCode !== 0) throw new Error(`Guest dependency install failed: ${installed.stderr}`);
  await vm.close();
  vm = undefined;
  copyDependencyCacheModules(join(build, "node_modules"), join(staging, "node_modules"));
  await writeFile(
    join(staging, "manifest.json"),
    JSON.stringify({
      format: repositoryDependencyCacheFormat,
      key,
      profile,
      nodeModules: "node_modules",
      runtime: { node, machine, osRelease: osRelease.filter(Boolean).join("\n") },
    }),
  );
  await rename(staging, target);
  console.log(JSON.stringify({ key, profile, path: target }));
} finally {
  await vm?.close();
  await rm(temporary, { recursive: true, force: true });
}
