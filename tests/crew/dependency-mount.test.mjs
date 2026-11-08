import test from "node:test";
import assert from "node:assert/strict";
import { buildDependencyMount } from "../../extensions/crew/runner/dependency-mount.mjs";

test("dependency snapshot is readable but refuses mutation", async () => {
  const { provider } = await buildDependencyMount({ snapshots: [{ manifest: { name: "demo", version: "1", files: {} }, files: { "index.js": Buffer.from("source") } }], failures: [] });
  assert.equal(String(await provider.readFile("/demo/index.js")), "source");
  await assert.rejects(provider.writeFile("/demo/index.js", "changed"));
  await assert.rejects(provider.open("/demo/index.js", "r+"));
  await assert.rejects(provider.unlink("/demo/index.js"));
  assert.equal(String(await provider.readFile("/demo/index.js")), "source");
});
