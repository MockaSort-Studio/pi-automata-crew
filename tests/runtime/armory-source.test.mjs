import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  referenceFromArtifacts,
  validateArtifactCatalog,
} from "../../extensions/crew/env-runtime/lib/armory-artifacts.mjs";
import { fetchSuiteExtension, sourceCacheRoot, sourceUrl } from "../../extensions/crew/runner/armory-source.mjs";

const BODY = Buffer.from("export const activateSuite = () => {};\n");
const HASH = createHash("sha256").update(BODY).digest("hex");
const SUITE = "collaboration/pi-github-tools";
const catalog = (override = {}) => ({
  revision: "a".repeat(40),
  sources: { [SUITE]: { file: "collaboration-pi-github-tools.mjs", sha256: HASH, size: BODY.length, ...override } },
});
const respond =
  (body, calls, status = 200) =>
  async (url) => {
    calls.push(url);
    return {
      ok: status === 200,
      status,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
const home = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "armory-src-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("the bundle is fetched from the URL built from the release and file name, verified, and cached", async (t) => {
  const h = home(t);
  const calls = [];
  const path = await fetchSuiteExtension({
    catalog: catalog(),
    suiteId: SUITE,
    home: h,
    fetchImpl: respond(BODY, calls),
  });
  assert.deepEqual(calls, [sourceUrl("a".repeat(40), "collaboration-pi-github-tools.mjs")]);
  assert.match(calls[0], /^https:\/\/github\.com\/MockaSort-Studio\/hall-armory\/releases\/download\/armory-a{40}\//);
  assert.equal(path, join(sourceCacheRoot(h), HASH, "collaboration-pi-github-tools.mjs"));
  assert.deepEqual(readFileSync(path), BODY);
  const again = await fetchSuiteExtension({
    catalog: catalog(),
    suiteId: SUITE,
    home: h,
    fetchImpl: respond(BODY, calls),
  });
  assert.equal(again, path);
  assert.equal(calls.length, 1, "a verified cache hit fetches nothing");
});

test("a tampered cache entry is replaced, never loaded", async (t) => {
  const h = home(t);
  const calls = [];
  const path = await fetchSuiteExtension({
    catalog: catalog(),
    suiteId: SUITE,
    home: h,
    fetchImpl: respond(BODY, calls),
  });
  writeFileSync(path, "export const activateSuite = () => { steal(); };\n");
  await fetchSuiteExtension({ catalog: catalog(), suiteId: SUITE, home: h, fetchImpl: respond(BODY, calls) });
  assert.equal(calls.length, 2);
  assert.deepEqual(readFileSync(path), BODY);
});

test("a body that does not match the pinned hash or size is refused and not cached", async (t) => {
  const h = home(t);
  const forged = Buffer.alloc(BODY.length, "x"); // same size, different content
  await assert.rejects(
    fetchSuiteExtension({ catalog: catalog(), suiteId: SUITE, home: h, fetchImpl: respond(forged, []) }),
    /pinned hash/,
  );
  await assert.rejects(
    fetchSuiteExtension({
      catalog: catalog({ size: BODY.length + 1 }),
      suiteId: SUITE,
      home: h,
      fetchImpl: respond(BODY, []),
    }),
    /unexpected size/,
  );
  assert.equal(existsSync(join(sourceCacheRoot(h), HASH)), false);
});

test("a release without a source, or an unavailable asset, is a clear error", async (t) => {
  const h = home(t);
  await assert.rejects(
    fetchSuiteExtension({ catalog: { revision: "a".repeat(40), sources: {} }, suiteId: SUITE, home: h }),
    /no extension source/,
  );
  await assert.rejects(
    fetchSuiteExtension({ catalog: catalog(), suiteId: SUITE, home: h, fetchImpl: respond(BODY, [], 404) }),
    /HTTP 404/,
  );
});

const document = (source) => ({
  format: "hall.armory-artifacts/v1",
  revision: "a".repeat(40),
  cache: {
    substituter: "https://hall-armory.cachix.org",
    publicKey: "hall-armory.cachix.org-1:xKu3F2f2lHnVSl9gyFi5Fsk2rs724sILlfdEIHWjWrc=",
  },
  catalog: { format: "hall.armory/v1" },
  suites: {
    [SUITE]: {
      manifestPath: "m.json",
      manifest: { format: "hall.armory-suite/v1" },
      ...(source ? { source } : {}),
      systems: {},
    },
  },
});

test("the catalog validator accepts a well-formed source entry and refuses malformed ones", () => {
  const good = { file: "collaboration-pi-github-tools.mjs", sha256: HASH, size: 10 };
  assert.deepEqual(referenceFromArtifacts(validateArtifactCatalog(document(good))).sources, { [SUITE]: good });
  assert.deepEqual(referenceFromArtifacts(validateArtifactCatalog(document())).sources, {});
  for (const bad of [
    { ...good, file: "../x.mjs" },
    { ...good, file: "x.js" },
    { ...good, sha256: "zz" },
    { ...good, size: 0 },
    { ...good, size: 9 * 1024 * 1024 },
  ])
    assert.throws(() => validateArtifactCatalog(document(bad)), /bad source bundle/);
});
