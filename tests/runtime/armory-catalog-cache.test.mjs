import { strict as assert } from "node:assert";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogCacheRoot, readCachedCatalog, writeCachedCatalog } from "../../extensions/crew/env-runtime/lib/armory-catalog-cache.mjs";

const home = () => mkdtempSync(join(tmpdir(), "armory-cache-"));
const doc = { revision: "a".repeat(40), value: "valid" };
const validate = (value) => {
  if (value?.value !== "valid") throw new Error("invalid");
  return value;
};
const read = (dir, options = {}) => readCachedCatalog("latest", { home: dir, validate, ...options });

test("cache round trips and ignores truncated files", () => {
  const dir = home();
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  assert.deepEqual(read(dir).doc, doc);
  writeFileSync(join(catalogCacheRoot(dir), "latest.json"), "{");
  assert.equal(read(dir), undefined);
});

test("a forged valid catalog in a writable directory is never trusted or overwritten", () => {
  const dir = home();
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  const root = catalogCacheRoot(dir);
  chmodSync(root, 0o777);
  writeFileSync(join(root, "latest.json"), JSON.stringify({ fetchedAt: "now", doc }));
  assert.equal(read(dir), undefined);
  assert.equal(writeCachedCatalog(doc, { home: dir }), false);
});

test("a symlinked cache directory is ignored", () => {
  const dir = home();
  const target = home();
  const root = catalogCacheRoot(dir);
  mkdirSync(join(dir, ".cache", "pi-crew"), { recursive: true });
  symlinkSync(target, root);
  writeFileSync(join(target, "latest.json"), JSON.stringify({ fetchedAt: "now", doc }));
  assert.equal(read(dir), undefined);
  assert.equal(writeCachedCatalog(doc, { home: dir }), false);
});

test("wrong ownership is ignored", () => {
  const dir = home();
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  assert.equal(read(dir, { uid: () => -1 }), undefined);
  assert.equal(writeCachedCatalog(doc, { home: dir, uid: () => -1 }), false);
});

test("predictable hostile symlink is not followed", () => {
  const dir = home();
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  const victim = join(dir, "victim");
  writeFileSync(victim, "safe");
  symlinkSync(victim, join(catalogCacheRoot(dir), `latest.json.${process.pid}.tmp`));
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  assert.equal(readFileSync(victim, "utf8"), "safe");
});

test("concurrent writers leave a complete valid catalog", async () => {
  const dir = home();
  await Promise.all(Array.from({ length: 20 }, async () => assert.equal(writeCachedCatalog(doc, { home: dir }), true)));
  assert.deepEqual(read(dir).doc, doc);
});
