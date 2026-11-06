import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { toGuestPath } from "../../extensions/crew/env-runtime/lib/gondolin-worker-paths.mjs";

const worker = readFileSync(new URL("../../extensions/crew/crew-runtime/lib/worker.mjs", import.meta.url), "utf8");
const extension = new URL("../../extensions/crew/env-runtime/lib/worker-gondolin-extension.mjs", import.meta.url);

test("maps host workspace paths into the sole guest workspace mount", () => {
  assert.equal(toGuestPath("/worker", "src/file.mjs"), "/workspace/src/file.mjs");
  assert.equal(toGuestPath("/worker", "/worker/src/file.mjs"), "/workspace/src/file.mjs");
  assert.equal(toGuestPath("/worker", "/outside/file.mjs"), "/outside/file.mjs");
});

test("a gondolin sandbox worker loads the project-owned internal extension", () => {
  assert.match(worker, /config\.sandbox\?\.kind === "gondolin"/);
  assert.match(
    worker,
    /resolve\(\s*config\.extensionCwd,\s*"extensions",\s*"crew",\s*"env-runtime",\s*"lib",\s*"worker-gondolin-extension\.mjs",?\s*\)/,
  );
});

test("the Gondolin extension routes tools through a private persistent guest workspace", () => {
  const source = readFileSync(extension, "utf8");
  assert.match(source, /const workspace = new WorkspaceProvider\(\)/);
  assert.match(source, /\[GUEST_WORKSPACE\]: workspace/);
  assert.doesNotMatch(source, /ShadowProvider|createShadowPathPredicate/);
  for (const tool of ["localRead", "localWrite", "localEdit", "localBash", "localLs", "localFind"])
    assert.match(source, new RegExp(`routed\\(${tool}`));
  assert.match(source, /\.\.\.localGrep/);
  assert.match(source, /pi\.on\("user_bash"/);
  assert.match(source, /pi\.on\("session_shutdown", async \(event\)/);
  assert.match(source, /if \(event\.reason !== "quit"\) return;/);
  assert.match(source, /await activeVm\.close\(\)/);
});

test("a required lockfile-keyed cache replaces only guest node_modules with a read-only mount", () => {
  const source = readFileSync(extension, "utf8");
  assert.match(source, /workerDependencyCache/);
  assert.match(source, /GUEST_WORKSPACE}\/?node_modules/);
  assert.match(source, /new ReadonlyProvider\(\s*new RealFSProvider\(dependencyCache\.modulesPath\)/);
});

test("VM state is module-level, so a same-process reload never boots a second VM", () => {
  const source = readFileSync(extension, "utf8");
  const vmDeclaredAt = source.indexOf("let vm;");
  const factoryDeclaredAt = source.indexOf("export default function gondolinWorkerExtension");
  assert.ok(vmDeclaredAt >= 0 && vmDeclaredAt < factoryDeclaredAt, "vm state must be module-level, not per-invocation");
});
