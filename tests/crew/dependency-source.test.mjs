import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotPackage } from "../../extensions/crew/runner/dependency-source.mjs";

test("snapshots pinned source without symlinks, credentials, or parent escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "crew-source-"));
  try {
    mkdirSync(join(root, "lib"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo", version: "1.2.3", token: "secret" }));
    writeFileSync(join(root, "lib", "index.js"), "export default 1;\n");
    writeFileSync(join(root, ".npmrc"), "secret");
    writeFileSync(join(root, "lib", "credentials.js"), "secret");
    symlinkSync("/etc/passwd", join(root, "lib", "escape.js"));
    const result = snapshotPackage(root, { name: "demo", version: "1.2.3" });
    assert.deepEqual(Object.keys(result.files).sort(), ["lib/index.js", "package.json"]);
    assert.equal(result.files["package.json"].toString().includes("secret"), false);
    assert.match(result.manifest.files["lib/index.js"], /^[0-9a-f]{64}$/);
    assert.throws(() => snapshotPackage(root, { name: "demo", version: "1.2.4" }), /version/);
    assert.throws(() => snapshotPackage(join(root, "missing"), { name: "demo", version: "1.2.3" }), /unavailable/);
    symlinkSync(root, join(root, "link"));
    assert.throws(() => snapshotPackage(join(root, "link"), { name: "demo", version: "1.2.3" }), /unavailable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
