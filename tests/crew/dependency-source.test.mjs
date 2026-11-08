import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { DEPENDENCY_PINS } from "../../extensions/crew/runner/dependency-pins.mjs";
import { extractVerifiedPackage } from "../../extensions/crew/runner/dependency-source.mjs";

function archive(name, body, type = "0") {
  const data = Buffer.from(body), header = Buffer.alloc(512);
  header.write(name, 0); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136);
  header.fill(32, 148, 156); header.write(type, 156); header.write("ustar\0", 257);
  header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512), Buffer.alloc(1024)]));
}
test("reviewed pins match the project lock", () => {
  const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url)));
  for (const pin of DEPENDENCY_PINS) {
    const entry = lock.packages[`node_modules/${pin.name}`];
    assert.equal(pin.version, entry.version);
    assert.equal(pin.integrity, entry.integrity);
  }
});
const sri = (bytes) => "sha512-" + createHash("sha512").update(bytes).digest("base64");
test("verifies full artifact before extraction and manifests actual file bytes", () => {
  const bytes = archive("package/index.js", "hello");
  const result = extractVerifiedPackage(bytes, { name: "demo", version: "1.2.3", integrity: sri(bytes) });
  assert.equal(result.files["index.js"].toString(), "hello");
  assert.equal(result.manifest.files["index.js"], createHash("sha256").update("hello").digest("hex"));
  assert.throws(() => extractVerifiedPackage(bytes, { name: "demo", version: "1.2.3", integrity: sri(Buffer.from("wrong")) }), /integrity/);
  assert.throws(() => extractVerifiedPackage(bytes, { name: "demo", version: "1.2.3", integrity: "sha512-bad" }), /integrity/);
  for (const name of ["package/../secret", "/etc/passwd", "package/.npmrc"]) {
    const bad = archive(name, "secret");
    assert.throws(() => extractVerifiedPackage(bad, { name: "demo", version: "1.2.3", integrity: sri(bad) }), /archive/);
  }
  const link = archive("package/link", "", "2");
  assert.throws(() => extractVerifiedPackage(link, { name: "demo", version: "1.2.3", integrity: sri(link) }), /archive/);
});
