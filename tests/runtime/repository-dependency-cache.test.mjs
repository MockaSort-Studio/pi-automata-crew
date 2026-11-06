import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  copyDependencyCacheModules,
  dependencyCacheDirectory,
  dependencyCacheKey,
  repositoryDependencyCacheFormat,
  resolveRepositoryDependencyCache,
  workerDependencyCache,
} from "../../extensions/crew/env-runtime/lib/repository-dependency-cache.mjs";

const profile = "gondolin-alpine-node24";
const runtime = { node: "v24.14.1", machine: "aarch64", osRelease: "NAME=Alpine" };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crew-dependency-cache-"));
  const cwd = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "package-lock.json"), '{"lockfileVersion":3}\n');
  return { root, cwd, home, profile, key: dependencyCacheKey(join(cwd, "package-lock.json"), profile) };
}

function cache({ home, key, profile: cacheProfile = profile }) {
  const directory = dependencyCacheDirectory(key, home);
  mkdirSync(join(directory, "node_modules"), { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      format: repositoryDependencyCacheFormat,
      key,
      profile: cacheProfile,
      nodeModules: "node_modules",
      runtime,
    }),
  );
  return directory;
}

test("copied executable links remain relative and resolve after the build is removed", () => {
  const item = fixture();
  try {
    const source = join(item.root, "build", "node_modules");
    const destination = join(item.root, "cache", "node_modules");
    mkdirSync(join(source, ".bin"), { recursive: true });
    mkdirSync(join(source, "tool"), { recursive: true });
    writeFileSync(join(source, "tool", "cli.js"), "tool");
    symlinkSync("../tool/cli.js", join(source, ".bin", "tool"));
    copyDependencyCacheModules(source, destination);
    rmSync(join(item.root, "build"), { recursive: true });
    assert.equal(readlinkSync(join(destination, ".bin", "tool")), "../tool/cli.js");
    assert.equal(readFileSync(join(destination, ".bin", "tool"), "utf8"), "tool");
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
});

test("cache copy rejects broken, absolute, and escaping executable links", () => {
  for (const target of ["../missing", "/tmp/outside", "../../../outside"]) {
    const item = fixture();
    try {
      const source = join(item.root, "build", "node_modules");
      mkdirSync(join(source, ".bin"), { recursive: true });
      writeFileSync(join(item.root, "outside"), "outside");
      symlinkSync(target, join(source, ".bin", "tool"));
      assert.throws(() => copyDependencyCacheModules(source, join(item.root, "cache", "node_modules")), /link/i);
    } finally {
      rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("nested executable links cannot escape through another symlink", () => {
  const item = fixture();
  try {
    const source = join(item.root, "build", "node_modules");
    const bin = join(source, "package", "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(item.root, "outside"), "outside");
    symlinkSync(join(item.root, "outside"), join(source, "redirect"));
    symlinkSync("../../../redirect", join(bin, "tool"));
    assert.throws(() => copyDependencyCacheModules(source, join(item.root, "cache", "node_modules")), /link/i);
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
});

test("a guest-profile and lockfile keyed cache resolves to a shared read-only mount source", () => {
  const item = fixture();
  try {
    const directory = cache(item);
    assert.deepEqual(resolveRepositoryDependencyCache(item), {
      key: item.key,
      profile,
      modulesPath: join(directory, "node_modules"),
      runtime,
    });
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
});

test("a cache profile participates in identity and mismatches fail before worker startup", () => {
  const item = fixture();
  try {
    assert.notEqual(item.key, dependencyCacheKey(join(item.cwd, "package-lock.json"), "other-guest"));
    assert.throws(() => resolveRepositoryDependencyCache(item), /dependency cache .* unavailable/);
    const directory = cache(item);
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        format: repositoryDependencyCacheFormat,
        key: item.key,
        profile: "other-guest",
        nodeModules: "node_modules",
        runtime,
      }),
    );
    assert.throws(() => resolveRepositoryDependencyCache(item), /dependency cache .* unavailable/);
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
});

test("worker configuration contains only cache identity, never a host cache path", () => {
  const item = fixture();
  try {
    cache(item);
    assert.deepEqual(
      workerDependencyCache({ cwd: item.cwd, dependencyCache: { key: item.key, profile } }, { home: item.home }),
      {
        key: item.key,
        profile,
        modulesPath: join(dependencyCacheDirectory(item.key, item.home), "node_modules"),
        runtime,
      },
    );
    assert.throws(
      () =>
        workerDependencyCache(
          { cwd: item.cwd, dependencyCache: { key: "not-a-digest", profile } },
          { home: item.home },
        ),
      /invalid/,
    );
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
});
