import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const extension = new URL("../../.pi/extensions/hall-crew/env-runtime/lib/worker-gondolin-extension.mjs", import.meta.url).href;

// Runs in a child with no inherited fd 3. Pi logs a handler error and keeps going, so the
// extension must end the worker itself when its sandbox cannot be set up.
function runSessionStart(config) {
  const dir = mkdtempSync(join(tmpdir(), "gondolin-setup-"));
  const path = join(dir, "worker.json");
  writeFileSync(path, JSON.stringify(config));
  const script = `
    const { default: extension } = await import(${JSON.stringify(extension)});
    const handlers = new Map();
    extension({ registerTool() {}, on: (name, handler) => handlers.set(name, handler) });
    await handlers.get("session_start")();
    console.log("SETUP-RETURNED");
    process.exit(0);`;
  try {
    return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PI_CREW_WORKER_CONFIG: path },
      timeout: 60_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an invalid Armory config ends the worker with a clear message instead of leaving it half-set-up", () => {
  const result = runSessionStart({ armory: { nixPaths: ["/nix/store"], suites: [] } });
  assert.equal(result.status, 70, result.stderr);
  assert.match(result.stderr, /Gondolin sandbox setup failed: .*invalid Nix mount/);
  assert.doesNotMatch(result.stdout, /SETUP-RETURNED/);
});

test("a valid config with no suite completes setup normally", () => {
  const result = runSessionStart({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SETUP-RETURNED/);
});
