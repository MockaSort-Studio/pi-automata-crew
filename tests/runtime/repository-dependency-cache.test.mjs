import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("cache executable links survive relocation and reject invalid targets", () => {
  const item = fixture();
  try {
    const source = join(item.root, "build", "node_modules");
    const destination = join(item.root, "cache", "node_modules");
    mkdirSync(join(source, ".bin"), { recursive: true });
    mkdirSync(join(source, "tool"), { recursive: true });
    writeFileSync(join(source, "tool", "cli.js"), "ok");
    symlinkSync("../tool/cli.js", join(source, ".bin", "tool"));
    copyDependencyCacheModules(source, destination);
    rmSync(join(item.root, "build"), { recursive: true });
    assert.equal(realpathSync(join(destination, ".bin", "tool")), realpathSync(join(destination, "tool", "cli.js")));
    symlinkSync("../missing", join(destination, ".bin", "broken"));
    assert.throws(() => copyDependencyCacheModules(destination, join(item.root, "invalid")), /link/i);
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
});

test("rejects symlinked .bin directories, directory targets, and invalid nested executables", () => {
  for (const shape of ["symlinked", "directory", "nested"]) {
    const item = fixture();
    try {
      const source = join(item.root, "source");
      mkdirSync(join(source, "pkg"), { recursive: true });
      if (shape === "symlinked") {
        symlinkSync("pkg", join(source, ".bin"));
        symlinkSync("/etc/passwd", join(source, "pkg", "x"));
      } else if (shape === "directory") {
        mkdirSync(join(source, ".bin"));
        symlinkSync("../pkg", join(source, ".bin", "x"));
      } else {
        const bin = join(source, "pkg", "node_modules", ".bin");
        mkdirSync(bin, { recursive: true });
        symlinkSync("/etc/passwd", join(bin, "x"));
      }
      assert.throws(
        () => copyDependencyCacheModules(source, join(item.root, "dest")),
        /Invalid dependency cache executable link/,
      );
    } finally {
      rmSync(item.root, { recursive: true, force: true });
    }
  }
});

test("accepts chained executable links and odd filenames in nested .bin directories", () => {
  const item = fixture();
  try {
    const source = join(item.root, "source");
    const bin = join(source, "pkg", "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(source, "pkg", "odd space\n😀"), "ok");
    symlinkSync("../../odd space\n😀", join(bin, "intermediate"));
    symlinkSync("intermediate", join(bin, "chain 😀"));
    const dest = join(item.root, "dest");
    copyDependencyCacheModules(source, dest);
    assert.equal(
      realpathSync(join(dest, "pkg", "node_modules", ".bin", "chain 😀")),
      realpathSync(join(dest, "pkg", "odd space\n😀")),
    );
  } finally {
    rmSync(item.root, { recursive: true, force: true });
  }
});

test("old format cache is not reused and the new key can be rebuilt", () => {
  const item = fixture();
  try {
    const old = cache(item);
    writeFileSync(
      join(old, "manifest.json"),
      JSON.stringify({
        format: "pi-crew-repository-dependency-cache/v2",
        key: item.key,
        profile,
        nodeModules: "node_modules",
        runtime,
      }),
    );
    assert.throws(() => resolveRepositoryDependencyCache(item), /unavailable/);
    cache(item);
    assert.equal(resolveRepositoryDependencyCache(item).key, item.key);
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
