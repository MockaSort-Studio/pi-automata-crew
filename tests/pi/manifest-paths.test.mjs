import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Keep the `pi` package manifest honest: every path it declares must exist on
// disk, and the extension entry points the relocated-load test exercises
// (tests/pi/test-extension-load.sh) must stay listed in the manifest. If
// either side drifts, this test fails instead of silently shipping a broken
// install.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const loaderScript = readFileSync(new URL("./test-extension-load.sh", import.meta.url), "utf8");

test("package.json declares a pi manifest with extensions and skills", () => {
  assert.ok(packageJson.pi, 'package.json is missing a top-level "pi" manifest');
  assert.ok(Array.isArray(packageJson.pi.extensions) && packageJson.pi.extensions.length > 0);
  assert.ok(Array.isArray(packageJson.pi.skills) && packageJson.pi.skills.length > 0);
});

test("every manifest extension path exists on disk", () => {
  for (const path of packageJson.pi.extensions) {
    assert.ok(existsSync(new URL(path, `file://${repoRoot}`)), `manifest extension path missing: ${path}`);
  }
});

test("every manifest skills path exists on disk", () => {
  for (const path of packageJson.pi.skills) {
    assert.ok(existsSync(new URL(path, `file://${repoRoot}`)), `manifest skills path missing: ${path}`);
  }
});

test("manifest extensions cover every -e entry point loaded by the relocated-load test", () => {
  const loadedPaths = [...loaderScript.matchAll(/-e\s+(extensions\/\S+)/g)].map((match) => match[1]);
  assert.ok(loadedPaths.length > 0, "could not find any -e extension paths in test-extension-load.sh");
  for (const loadedPath of loadedPaths) {
    assert.ok(
      packageJson.pi.extensions.includes(loadedPath),
      `test-extension-load.sh loads ${loadedPath} but it is not declared in the package.json pi manifest`,
    );
  }
});
