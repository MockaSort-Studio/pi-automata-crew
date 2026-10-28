import { strict as assert } from "node:assert";
import test from "node:test";
import { armoryCache, fetchArtifactCatalog, pinnedReleaseUrl, readCatalogSuite, referenceFromArtifacts, resolveArmoryCatalog, validateArtifactCatalog } from "../../.pi/extensions/hall-crew/env-runtime/lib/armory-artifacts.mjs";

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
      systems: { "aarch64-linux": { storePath: path("a"), narHash, closure: [{ path: path("a"), narHash, narSize: 1 }] } },
    },
  },
});
const respond = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test("a valid catalog resolves without Nix and exposes embedded manifests and artifacts", async () => {
  const reference = referenceFromArtifacts(validateArtifactCatalog(document()));
  assert.equal(reference.release, pinnedReleaseUrl(revision));
  assert.deepEqual(await readCatalogSuite(reference, "collaboration/github/manifest.json"), { format: "hall.armory-suite/v1", tools: ["t"] });
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
  assert.throws(bad((d) => (d.format = "x")), /unsupported format/);
  assert.throws(bad((d) => (d.revision = "main")), /full git commit/);
  assert.throws(bad((d) => (d.suites["collaboration/pi-github-tools"].systems["aarch64-linux"].storePath = "/tmp/x")), /bad store path/);
  assert.throws(bad((d) => (d.suites["collaboration/pi-github-tools"].systems["aarch64-linux"].closure = [])), /omits its root/);
  assert.throws(bad((d) => (d.suites["collaboration/pi-github-tools"].systems.riscv = {})), /unknown system/);
});

test("an unavailable release is an error the resolver can fall back from", async () => {
  await assert.rejects(fetchArtifactCatalog({ fetchImpl: respond({}, false, 404) }), /HTTP 404/);
});

test("the release is the only entrypoint: an unreachable one is an error, never a second source", async () => {
  await assert.rejects(resolveArmoryCatalog({ fetchImpl: respond({}, false, 503) }), /HTTP 503/);
  await assert.rejects(resolveArmoryCatalog({ fetchImpl: async () => Promise.reject(new Error("offline")) }), /offline/);
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
    fetchImpl: async (url) => ((requested = url), respond(document())()),
  });
  assert.equal(requested, pinnedReleaseUrl(revision));
  assert.equal(resolved.revision, revision);
});
