import { strict as assert } from "node:assert";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  catalogCacheRoot,
  readCachedCatalog,
  writeCachedCatalog,
} from "../../extensions/crew/env-runtime/lib/armory-catalog-cache.mjs";

const homes = [];
const home = () => { const dir = mkdtempSync(join(tmpdir(), "armory-cache-")); homes.push(dir); return dir; };
test.after(() => { for (const dir of homes) rmSync(dir, { recursive: true, force: true }); });
const doc = { revision: "a".repeat(40), value: "valid" };
const validate = (value) => {
  if (value?.value !== "valid") throw new Error("invalid");
  return value;
};
const read = (dir, options = {}) => readCachedCatalog("latest", { home: dir, validate, ...options });

test("cache round trips and ignores truncated files", () => {
  const dir = home();
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  assert.equal(statSync(catalogCacheRoot(dir)).mode & 0o777, 0o700);
  assert.equal(statSync(join(catalogCacheRoot(dir), "latest.json")).mode & 0o777, 0o600);
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
  assert.equal(read(dir, { uid: null }), undefined);
  assert.equal(writeCachedCatalog(doc, { home: dir, uid: null }), false);
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

test("rejects writable and symlinked ancestors and a swapped cache file", () => {
  const dir = home();
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  const ancestor = join(dir, ".cache");
  chmodSync(ancestor, 0o777);
  assert.equal(read(dir), undefined);
  assert.equal(writeCachedCatalog(doc, { home: dir }), false);
  chmodSync(ancestor, 0o700);
  const root = catalogCacheRoot(dir);
  const file = join(root, "latest.json");
  const target = join(dir, "target");
  writeFileSync(target, JSON.stringify({ fetchedAt: "now", doc }));
  unlinkSync(file);
  symlinkSync(target, file);
  assert.equal(read(dir), undefined);
  rmSync(ancestor, { recursive: true });
  const external = home();
  mkdirSync(join(external, "pi-crew", "armory-catalog"), { recursive: true });
  writeFileSync(join(external, "pi-crew", "armory-catalog", "latest.json"), JSON.stringify({ fetchedAt: "now", doc }));
  symlinkSync(external, ancestor);
  assert.equal(read(dir), undefined);
  assert.equal(writeCachedCatalog(doc, { home: dir }), false);
});

test("exclusive temporary creation rejects a forced collision", () => {
  const dir = home();
  assert.equal(writeCachedCatalog(doc, { home: dir }), true);
  const collision = join(catalogCacheRoot(dir), `latest.json.${"ab".repeat(16)}.tmp`);
  writeFileSync(collision, "hostile");
  assert.equal(writeCachedCatalog(doc, { home: dir, random: () => Buffer.alloc(16, 0xab) }), false);
  assert.equal(readFileSync(collision, "utf8"), "hostile");
});

test("concurrent writers leave a complete valid catalog", async () => {
  const dir = home();
  const moduleUrl = new URL("../../extensions/crew/env-runtime/lib/armory-catalog-cache.mjs", import.meta.url).href;
  const script = `import { writeCachedCatalog } from ${JSON.stringify(moduleUrl)}; for (let i = 0; i < 20; i++) if (!writeCachedCatalog(${JSON.stringify(doc)}, { home: ${JSON.stringify(dir)} })) process.exit(1);`;
  const jobs = Array.from(
    { length: 8 },
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script]);
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer exited ${code}`))));
      }),
  );
  await Promise.all(jobs);
  assert.deepEqual(read(dir).doc, doc);
});
