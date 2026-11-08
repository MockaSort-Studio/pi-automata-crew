import test from "node:test";
import assert from "node:assert/strict";
import { buildDependencyMount } from "../../extensions/crew/runner/dependency-mount.mjs";
import { createEnvironment } from "../../extensions/crew/runner/environment.mjs";

test("dependency snapshot is readable but refuses mutation", async () => {
  const { provider } = await buildDependencyMount({
    snapshots: [{ manifest: { name: "demo", version: "1", files: {} }, files: { "index.js": Buffer.from("source") } }],
    failures: [],
  });
  assert.equal(String(await provider.readFile("/demo/index.js")), "source");
  await assert.rejects(provider.writeFile("/demo/index.js", "changed"));
  for (const flag of ["r+", "w", "w+", "a", "wx"]) await assert.rejects(provider.open("/demo/index.js", flag));
  await assert.rejects(provider.unlink("/demo/index.js"));
  await assert.rejects(provider.mkdir("/demo/new"));
  await assert.rejects(provider.rmdir("/demo"));
  await assert.rejects(provider.rename("/demo/index.js", "/other"));
  await assert.rejects(provider.rename("/other", "/demo/index.js"));
  await assert.rejects(provider.symlink("/elsewhere", "/demo/link"));
  await assert.rejects(provider.link("/demo/index.js", "/demo/link"));
  await assert.rejects(provider.chmod("/demo/index.js", 0o600));
  for (const name of ["truncate", "chown", "utimes"]) {
    if (typeof provider[name] === "function") await assert.rejects(provider[name]("/demo/index.js", 0));
  }
  const handle = await provider.open("/demo/index.js", "r");
  await assert.rejects(handle.write(Buffer.from("x"), 0, 1, 0));
  await assert.rejects(handle.truncate(0));
  await assert.rejects(handle.writeFile("bad"));
  assert.throws(() => handle.writeSync(Buffer.from("x"), 0, 1, 0));
  assert.throws(() => handle.writeFileSync("bad"));
  assert.throws(() => handle.truncateSync(0));
  await handle.close();
  const syncHandle = provider.openSync("/demo/index.js", "r");
  assert.throws(() => syncHandle.writeSync(Buffer.from("x"), 0, 1, 0));
  syncHandle.closeSync();
  assert.equal(String(await provider.readFile("/demo/index.js")), "source");
});

test("separate providers never alias each other or verified bytes", async () => {
  const bytes = Buffer.from("source");
  const input = { snapshots: [{ manifest: { name: "demo", version: "1", files: {} }, files: { "index.js": bytes } }], failures: [] };
  const first = await buildDependencyMount(input);
  const second = await buildDependencyMount(input);
  assert.notEqual(first.provider, second.provider);
  const mounts = [];
  const createVm = async (options) => { mounts.push(options.vfs.mounts); return { close: async () => {} }; };
  const a = createEnvironment({ localCwd: "/unused", dependencySources: first.provider, createVm, idleMs: 0 });
  const b = createEnvironment({ localCwd: "/unused", dependencySources: second.provider, createVm, idleMs: 0 });
  await a.withVm(() => {});
  await b.withVm(() => {});
  assert.notEqual(mounts[0]["/opt/crew/dependency-sources"], mounts[1]["/opt/crew/dependency-sources"]);
  await a.close();
  await b.close();
  const handle = await first.provider.backend.open("/demo/index.js", "r+");
  await handle.write(Buffer.from("X"), 0, 1, 0);
  await handle.close();
  assert.equal(String(await second.provider.readFile("/demo/index.js")), "source");
  assert.equal(String(bytes), "source");
});
