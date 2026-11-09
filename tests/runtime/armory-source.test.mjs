import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  referenceFromArtifacts,
  validateArtifactCatalog,
} from "../../extensions/crew/env-runtime/lib/armory-artifacts.mjs";
import {
  discardPrivateCopy,
  fetchSuiteExtension,
  sourceCacheRoot,
  sourceUrl,
} from "../../extensions/crew/runner/armory-source.mjs";
import { loadSuiteModule } from "../../extensions/crew/runner/github-suite.mjs";

const BODY = Buffer.from('export const activateSuite = () => {};\nexport const marker = "verified";\n');
const HOSTILE = Buffer.from('export const activateSuite = () => {};\nexport const marker = "attacker";\n');
const HASH = createHash("sha256").update(BODY).digest("hex");
const SUITE = "collaboration/pi-github-tools";
const FILE = "collaboration-pi-github-tools.mjs";
const catalog = (override = {}) => ({
  revision: "a".repeat(40),
  sources: { [SUITE]: { file: FILE, sha256: HASH, size: BODY.length, ...override } },
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
// Homes live under the real home: the cache refuses any home with a group- or world-writable ancestor (/tmp).
const home = (t) => {
  const dir = mkdtempSync(join(homedir(), ".armory-src-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const cachedFile = (h) => join(sourceCacheRoot(h), HASH, FILE);
const fetchInto = (h, calls, options = {}) =>
  fetchSuiteExtension({ catalog: catalog(), suiteId: SUITE, home: h, fetchImpl: respond(BODY, calls), ...options });

test("the bundle is fetched from the URL built from the release and file name, verified, and cached", async (t) => {
  const h = home(t);
  const calls = [];
  const path = await fetchInto(h, calls);
  t.after(() => discardPrivateCopy(path));
  assert.deepEqual(calls, [sourceUrl("a".repeat(40), FILE)]);
  assert.match(calls[0], /^https:\/\/github\.com\/MockaSort-Studio\/hall-armory\/releases\/download\/armory-a{40}\//);
  assert.deepEqual(readFileSync(cachedFile(h)), BODY);
  assert.equal(statSync(cachedFile(h)).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(cachedFile(h))).mode & 0o777, 0o700);
  assert.deepEqual(readFileSync(path), BODY);
  const again = await fetchInto(h, calls);
  t.after(() => discardPrivateCopy(again));
  assert.deepEqual(readFileSync(again), BODY);
  assert.equal(calls.length, 1, "a verified cache hit fetches nothing");
});

test("the loaded path is a private copy of the verified bytes, discarded once imported", async (t) => {
  const h = home(t);
  const path = await fetchInto(h, []);
  assert.ok(!path.startsWith(sourceCacheRoot(h)), "the cache path itself is never handed to import");
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
  assert.equal(statSync(path).uid, process.getuid());
  assert.equal((await loadSuiteModule(path)).marker, "verified");
  assert.equal(existsSync(dirname(path)), false);
  assert.equal(discardPrivateCopy(cachedFile(h)), false, "paths it did not create are never removed");
  assert.equal(existsSync(cachedFile(h)), true);
});

test("swapping the cached file after it was verified does not change what is imported", async (t) => {
  const h = home(t);
  const calls = [];
  discardPrivateCopy(await fetchInto(h, calls));
  const path = await fetchInto(h, calls); // verified cache hit
  assert.equal(calls.length, 1);
  writeFileSync(cachedFile(h), HOSTILE); // the attacker's window: after the hash check, before the import
  assert.equal((await loadSuiteModule(path)).marker, "verified");
});

test("a world-writable cache directory is neither trusted nor written", async (t) => {
  const h = home(t);
  const directory = dirname(cachedFile(h));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o777);
  writeFileSync(cachedFile(h), BODY); // hash-valid, but anyone could swap it
  const calls = [];
  const path = await fetchInto(h, calls);
  t.after(() => discardPrivateCopy(path));
  assert.equal(calls.length, 1, "the untrusted cache entry is not used");
  assert.ok(!path.startsWith(directory));
  assert.deepEqual(readFileSync(path), BODY);
  chmodSync(directory, 0o700);
  chmodSync(dirname(directory), 0o777); // a writable ancestor inside the cache is refused too
  const again = await fetchInto(h, calls);
  t.after(() => discardPrivateCopy(again));
  assert.equal(calls.length, 2);
});

test("a symlinked cache file is not followed", async (t) => {
  const h = home(t);
  const calls = [];
  discardPrivateCopy(await fetchInto(h, calls));
  const elsewhere = join(h, "elsewhere.mjs");
  writeFileSync(elsewhere, BODY);
  rmSync(cachedFile(h));
  symlinkSync(elsewhere, cachedFile(h));
  const path = await fetchInto(h, calls);
  t.after(() => discardPrivateCopy(path));
  assert.equal(calls.length, 2);
});

test("a planted symlink at a temporary path is never followed", async (t) => {
  const h = home(t);
  const directory = dirname(cachedFile(h));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const victim = join(h, "victim");
  writeFileSync(victim, "safe");
  // The previous, predictable temporary name, and the exact name an injected random source would produce.
  symlinkSync(victim, `${cachedFile(h)}.${process.pid}.tmp`);
  symlinkSync(victim, `${cachedFile(h)}.${"ab".repeat(16)}.tmp`);
  const path = await fetchInto(h, [], { random: () => Buffer.alloc(16, 0xab) });
  t.after(() => discardPrivateCopy(path));
  assert.equal(readFileSync(victim, "utf8"), "safe");
  assert.deepEqual(readFileSync(path), BODY, "a failed cache write still loads the verified bytes");
});

test("a tampered cache entry is replaced, never loaded", async (t) => {
  const h = home(t);
  const calls = [];
  discardPrivateCopy(await fetchInto(h, calls));
  writeFileSync(cachedFile(h), "export const activateSuite = () => { steal(); };\n");
  const path = await fetchInto(h, calls);
  t.after(() => discardPrivateCopy(path));
  assert.equal(calls.length, 2);
  assert.deepEqual(readFileSync(cachedFile(h)), BODY);
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

test("a release without a source, a malformed entry, or an unavailable asset, is a clear error", async (t) => {
  const h = home(t);
  await assert.rejects(
    fetchSuiteExtension({ catalog: { revision: "a".repeat(40), sources: {} }, suiteId: SUITE, home: h }),
    /no extension source/,
  );
  for (const bad of [{ file: "../x.mjs" }, { sha256: "../../x" }, { size: 0 }])
    await assert.rejects(
      fetchSuiteExtension({ catalog: catalog(bad), suiteId: SUITE, home: h, fetchImpl: respond(BODY, []) }),
      /malformed/,
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
