import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  armoryCache,
  fetchArtifactCatalog,
  pinnedReleaseUrl,
  readCatalogSuite,
  referenceFromArtifacts,
  resolveArmoryCatalog,
  validateArtifactCatalog,
} from "../../extensions/crew/env-runtime/lib/armory-artifacts.mjs";

const homes = [];
const freshHome = () => {
  const dir = mkdtempSync(join(homedir(), ".armory-artifacts-test-"));
  homes.push(dir);
  return dir;
};
test.after(() => {
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
});
const revision = "0123456789abcdef0123456789abcdef01234567";
const path = (seed) => `/nix/store/${seed.repeat(32).slice(0, 32)}-x`;
const narHash = `sha256-${"A".repeat(43)}=`;
const document = () => ({
  format: "hall.armory-artifacts/v1",
  revision,
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
const respond =
  (body, ok = true, status = 200) =>
  async () => ({ ok, status, text: async () => JSON.stringify(body) });

test("a valid catalog resolves without Nix and exposes embedded manifests and artifacts", async () => {
  const reference = referenceFromArtifacts(validateArtifactCatalog(document()));
  assert.equal(reference.release, pinnedReleaseUrl(revision));
  assert.deepEqual(await readCatalogSuite(reference, "collaboration/github/manifest.json"), {
    format: "hall.armory-suite/v1",
    tools: ["t"],
  });
  assert.ok(reference.artifacts["collaboration/pi-github-tools"]["aarch64-linux"].storePath);
});

test("a catalog that names a different cache is refused", () => {
  const doc = document();
  doc.cache.substituter = "https://evil.example";
  assert.throws(() => validateArtifactCatalog(doc), /different binary cache/);
  const keyed = document();
  keyed.cache.publicKey = "other-1:key";
  assert.throws(() => validateArtifactCatalog(keyed), /different binary cache/);
});

test("malformed catalogs are refused", () => {
  const bad = (change) => {
    const doc = document();
    change(doc);
    return () => validateArtifactCatalog(doc);
  };
  assert.throws(
    bad((d) => (d.format = "x")),
    /unsupported format/,
  );
  assert.throws(
    bad((d) => (d.revision = "main")),
    /full git commit/,
  );
  assert.throws(
    bad((d) => (d.suites["collaboration/pi-github-tools"].systems["aarch64-linux"].storePath = "/tmp/x")),
    /bad store path/,
  );
  assert.throws(
    bad((d) => (d.suites["collaboration/pi-github-tools"].systems["aarch64-linux"].closure = [])),
    /omits its root/,
  );
  assert.throws(
    bad((d) => (d.suites["collaboration/pi-github-tools"].systems.riscv = {})),
    /unknown system/,
  );
});

test("an unavailable release is an error the resolver can fall back from", async () => {
  await assert.rejects(fetchArtifactCatalog({ fetchImpl: respond({}, false, 404) }), /HTTP 404/);
});

test("the release is the only entrypoint: an unreachable one is an error, never a second source", async () => {
  await assert.rejects(resolveArmoryCatalog({ home: freshHome(), fetchImpl: respond({}, false, 503) }), /HTTP 503/);
  await assert.rejects(
    resolveArmoryCatalog({ home: freshHome(), fetchImpl: async () => Promise.reject(new Error("offline")) }),
    /offline/,
  );
});

test("manifests are read only from the release and cannot escape it", () => {
  const reference = referenceFromArtifacts(document());
  assert.throws(() => readCatalogSuite(reference, "../secret.json"), /non-escaping/);
  assert.throws(() => readCatalogSuite(reference, "/etc/passwd"), /non-escaping/);
  assert.throws(() => readCatalogSuite(reference, "other/manifest.json"), /not in the release/);
});

test("a pinned release is fetched from its immutable URL", async () => {
  let requested;
  const resolved = await resolveArmoryCatalog({
    release: pinnedReleaseUrl(revision),
    home: freshHome(),
    fetchImpl: async (url) => ((requested = url), respond(document())()),
  });
  assert.equal(requested, pinnedReleaseUrl(revision));
  assert.equal(resolved.revision, revision);
});

test("offline latest uses only a validated cached catalog", async () => {
  const home = freshHome();
  await resolveArmoryCatalog({ home, fetchImpl: respond(document()) });
  const hit = await resolveArmoryCatalog({ home, fetchImpl: respond({}, false, 503) });
  assert.equal(hit.fromCache, true);
  assert.equal(hit.revision, revision);
  assert.match(hit.cachedAt, /^\d{4}-/);
});

test("invalid received payloads never fall back to cache", async () => {
  const home = freshHome();
  await resolveArmoryCatalog({ home, fetchImpl: respond(document()) });
  await assert.rejects(
    resolveArmoryCatalog({
      home,
      fetchImpl: async () => ({
        ok: true,
        text: async () => "{malformed",
      }),
    }),
    SyntaxError,
  );
  const invalid = document();
  invalid.suites["collaboration/pi-github-tools"].systems["aarch64-linux"].closure = {};
  await assert.rejects(resolveArmoryCatalog({ home, fetchImpl: respond(invalid) }), TypeError);
  invalid.cache.publicKey = "wrong";
  await assert.rejects(resolveArmoryCatalog({ home, fetchImpl: respond(invalid) }), /different binary cache/);
});

test("body transport failures fall back but malformed bytes do not", async () => {
  const home = freshHome();
  await resolveArmoryCatalog({ home, fetchImpl: respond(document()) });
  const hit = await resolveArmoryCatalog({
    home,
    fetchImpl: async () => ({
      ok: true,
      text: async () => {
        throw new Error("reset");
      },
    }),
  });
  assert.equal(hit.fromCache, true);
  await assert.rejects(
    resolveArmoryCatalog({ home, fetchImpl: async () => ({ ok: true, text: async () => "{" }) }),
    SyntaxError,
  );
});

test("one total budget bounds stalled headers and bodies", async () => {
  const home = freshHome();
  await resolveArmoryCatalog({ home, fetchImpl: respond(document()) });
  for (const fetchImpl of [
    () => new Promise(() => {}),
    async () => ({ ok: true, text: () => new Promise(() => {}) }),
  ]) {
    const start = Date.now();
    const hit = await resolveArmoryCatalog({ home, fetchImpl, budgetMs: 30 });
    assert.equal(hit.fromCache, true);
    assert.ok(Date.now() - start < 500);
  }
});

test("pinned responses must match and explicit noncanonical URLs never fall back", async () => {
  const home = freshHome();
  await resolveArmoryCatalog({ home, fetchImpl: respond(document()) });
  const other = "a".repeat(40);
  await assert.rejects(
    resolveArmoryCatalog({ home, release: pinnedReleaseUrl(other), fetchImpl: respond(document()) }),
    /revision/i,
  );
  await assert.rejects(
    resolveArmoryCatalog({
      home,
      release: `https://evil.test/releases/download/armory-${revision}/artifacts.json`,
      fetchImpl: respond({}, false, 503),
    }),
    /HTTP 503/,
  );
  let called = false;
  const pinned = await resolveArmoryCatalog({
    home,
    release: pinnedReleaseUrl(revision),
    fetchImpl: async () => {
      called = true;
      throw new Error("offline");
    },
  });
  assert.equal(pinned.fromCache, true);
  assert.equal(called, false);
});

test("explicit release downloads do not replace the latest cache", async () => {
  const home = freshHome();
  await resolveArmoryCatalog({ home, fetchImpl: respond(document()) });
  const other = document();
  other.revision = "b".repeat(40);
  await resolveArmoryCatalog({ home, release: pinnedReleaseUrl(other.revision), fetchImpl: respond(other) });
  const latest = await resolveArmoryCatalog({ home, fetchImpl: respond({}, false, 503) });
  assert.equal(latest.revision, revision);
});
