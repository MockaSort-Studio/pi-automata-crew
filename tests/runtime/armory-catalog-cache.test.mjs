import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  armoryCache,
  pinnedReleaseUrl,
  resolveArmoryCatalog,
} from "../../extensions/crew/env-runtime/lib/armory-artifacts.mjs";
import { catalogCacheRoot } from "../../extensions/crew/env-runtime/lib/armory-catalog-cache.mjs";

const revision = (seed) => seed.repeat(40).slice(0, 40);
const path = (seed) => `/nix/store/${seed.repeat(32).slice(0, 32)}-x`;
const narHash = `sha256-${"A".repeat(43)}=`;
const document = (seed = "a") => ({
  format: "hall.armory-artifacts/v1",
  revision: revision(seed),
  cache: { ...armoryCache },
  catalog: { format: "hall.armory/v1", lockers: [] },
  suites: {
    "collaboration/pi-github-tools": {
      manifestPath: "collaboration/github/manifest.json",
      manifest: { format: "hall.armory-suite/v1", tools: ["t"] },
      systems: {
        "aarch64-linux": { storePath: path("a"), narHash, closure: [{ path: path("a"), narHash, narSize: 1 }] },
      },
    },
  },
});
const serving = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const failing =
  (status = 503) =>
  async () => ({ ok: false, status, json: async () => ({}) });
const home = () => mkdtempSync(join(tmpdir(), "armory-cache-"));

test("a downloaded catalog is cached, and the cached copy serves a later failed download", async () => {
  const dir = home();
  const first = await resolveArmoryCatalog({ home: dir, fetchImpl: serving(document("a")) });
  assert.equal(first.fromCache, undefined);
  const second = await resolveArmoryCatalog({ home: dir, fetchImpl: failing() });
  assert.equal(second.fromCache, true);
  assert.equal(second.revision, revision("a"));
  assert.match(second.cachedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("a failed download is retried before the cache is used", async () => {
  const dir = home();
  let calls = 0;
  const flaky = async () => (++calls === 1 ? failing()() : serving(document("a"))());
  const resolved = await resolveArmoryCatalog({ home: dir, fetchImpl: flaky });
  assert.equal(calls, 2);
  assert.equal(resolved.fromCache, undefined);
});

test("with nothing cached a failed download is an error that says so", async () => {
  await assert.rejects(resolveArmoryCatalog({ home: home(), fetchImpl: failing() }), /HTTP 503.*no cached/);
});

test("a downloaded catalog that is invalid is refused, never replaced by the cached one", async () => {
  const dir = home();
  await resolveArmoryCatalog({ home: dir, fetchImpl: serving(document("a")) });
  const hostile = document("b");
  hostile.cache.substituter = "https://evil.example";
  await assert.rejects(resolveArmoryCatalog({ home: dir, fetchImpl: serving(hostile) }), /different binary cache/);
});

test("a tampered cache file is ignored, not trusted", async () => {
  const dir = home();
  await resolveArmoryCatalog({ home: dir, fetchImpl: serving(document("a")) });
  const file = join(catalogCacheRoot(dir), "latest.json");
  const stored = JSON.parse(readFileSync(file, "utf8"));
  stored.doc.cache.substituter = "https://evil.example";
  writeFileSync(file, JSON.stringify(stored));
  await assert.rejects(resolveArmoryCatalog({ home: dir, fetchImpl: failing() }), /HTTP 503.*no cached/);
});

test("a pinned release is served from disk with no network once seen, and only for its own revision", async () => {
  const dir = home();
  await resolveArmoryCatalog({ home: dir, fetchImpl: serving(document("a")) });
  let requests = 0;
  const offline = async () => (requests++, failing()());
  const pinned = await resolveArmoryCatalog({
    home: dir,
    release: pinnedReleaseUrl(revision("a")),
    fetchImpl: offline,
  });
  assert.equal(pinned.revision, revision("a"));
  assert.equal(requests, 0);
  // Another revision was never seen: no fallback to a different release's catalog.
  await assert.rejects(
    resolveArmoryCatalog({ home: dir, release: pinnedReleaseUrl(revision("c")), fetchImpl: offline }),
    /HTTP 503/,
  );
});

test("a cache that cannot be written does not fail the launch", async () => {
  const blocker = join(home(), "file");
  writeFileSync(blocker, "not a directory");
  const resolved = await resolveArmoryCatalog({ home: blocker, fetchImpl: serving(document("a")) });
  assert.equal(resolved.revision, revision("a"));
});
