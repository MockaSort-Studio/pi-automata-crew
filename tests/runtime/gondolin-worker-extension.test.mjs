import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { toGuestPath } from "../../.pi/extensions/hall-crew/env-runtime/lib/gondolin-worker-paths.mjs";

const worker = readFileSync(new URL("../../.pi/extensions/hall-crew/crew-runtime/lib/worker.mjs", import.meta.url), "utf8");
const extension = new URL("../../.pi/extensions/hall-crew/env-runtime/lib/worker-gondolin-extension.mjs", import.meta.url);
const paths = new URL("../../.pi/extensions/hall-crew/env-runtime/lib/gondolin-worker-paths.mjs", import.meta.url);

test("maps host workspace paths into the sole guest workspace mount", () => {
  assert.equal(toGuestPath("/worker", "src/file.mjs"), "/workspace/src/file.mjs");
  assert.equal(toGuestPath("/worker", "/worker/src/file.mjs"), "/workspace/src/file.mjs");
  assert.equal(toGuestPath("/worker", "/outside/file.mjs"), "/outside/file.mjs");
});

test("a gondolin sandbox worker loads the project-owned internal extension", () => {
  assert.match(worker, /config\.sandbox\?\.kind === "gondolin"/);
  assert.match(
    worker,
    /resolve\(config\.extensionCwd, "\.pi", "extensions", "hall-crew", "env-runtime", "lib", "worker-gondolin-extension\.mjs"\)/,
  );
});

test("the Gondolin extension routes every workspace tool through one hidden workspace VM", () => {
  const source = readFileSync(extension, "utf8");
  const pathSource = readFileSync(paths, "utf8");
  assert.match(source, /new ShadowProvider\(new RealFSProvider\(localCwd\)/);
  for (const path of ["/.env", "/.npmrc", "/node_modules", "/.venv", "/dist"])
    assert.match(pathSource, new RegExp(`"${path}"`));
  for (const tool of ["localRead", "localWrite", "localEdit", "localBash", "localLs", "localFind"])
    assert.match(source, new RegExp(`routed\\(${tool}`));
  assert.match(source, /\.\.\.localGrep/);
  assert.match(source, /pi\.on\("user_bash"/);
  assert.match(source, /pi\.on\("session_shutdown", async \(event\)/);
  assert.match(source, /if \(event\.reason !== "quit"\) return;/);
  assert.match(source, /await activeVm\.close\(\)/);
});

test("VM state is module-level, so a same-process reload never boots a second VM", () => {
  const source = readFileSync(extension, "utf8");
  const vmDeclaredAt = source.indexOf("let vm;");
  const factoryDeclaredAt = source.indexOf("export default function gondolinWorkerExtension");
  assert.ok(vmDeclaredAt >= 0 && vmDeclaredAt < factoryDeclaredAt, "vm state must be module-level, not per-invocation");
});
