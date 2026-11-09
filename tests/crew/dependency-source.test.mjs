import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { DEPENDENCY_PINS } from "../../extensions/crew/runner/dependency-pins.mjs";
import { extractVerifiedPackage } from "../../extensions/crew/runner/dependency-source.mjs";
import {
  prepareSources,
  downloadArtifact,
  createSourceCache,
} from "../../extensions/crew/runner/dependency-bootstrap.mjs";
import { verificationFacts } from "../../extensions/crew/runner/verification-facts.mjs";

function archive(name, body, type = "0") {
  const data = Buffer.from(body),
    header = Buffer.alloc(512);
  header.write(name, 0);
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
  header.write("00000000000\0", 136);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write("ustar\0", 257);
  header.write(
    [...header]
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  return gzipSync(Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]));
}
test("reviewed pins match the project lock", () => {
  const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url)));
  for (const pin of DEPENDENCY_PINS) {
    const entry = lock.packages[`node_modules/${pin.name}`];
    assert.equal(pin.version, entry.version);
    assert.equal(pin.integrity, entry.integrity);
  }
});
test("absolute download deadline stops a continuously trickling response", async () => {
  const fakeGet = (_options, callback) => {
    const request = new EventEmitter();
    request.destroy = (error) => {
      clearInterval(trickle);
      request.emit("error", error);
    };
    const response = new EventEmitter();
    response.statusCode = 200;
    const trickle = setInterval(() => response.emit("data", Buffer.from("x")), 2);
    queueMicrotask(() => callback(response));
    return request;
  };
  await assert.rejects(downloadArtifact(DEPENDENCY_PINS[0], { get: fakeGet, deadlineMs: 30 }), /deadline/);
});
test("refused registry response is destroyed", async () => {
  const response = new EventEmitter();
  response.statusCode = 302;
  let destroyed = false;
  response.destroy = () => {
    destroyed = true;
  };
  const fakeGet = (_options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    queueMicrotask(() => callback(response));
    return request;
  };
  await assert.rejects(downloadArtifact(DEPENDENCY_PINS[0], { get: fakeGet }), /unavailable/);
  assert.equal(destroyed, true);
});
test("facts distinguish missing formatter and project CI", () => {
  const text = verificationFacts({ available: [], failures: ["prettier unavailable"] }, true);
  assert.match(text, /prettier unavailable/);
  assert.match(text, /hosted CI/i);
  assert.doesNotMatch(text, /formatter available/i);
  assert.match(verificationFacts({ available: ["prettier"], failures: [] }, true), /bin\/prettier.cjs/);
  assert.match(verificationFacts(undefined, false), /bash.*not granted/i);
});
test("facts state the guest's real limits: no git, BusyBox grep, source-only ws and typebox", () => {
  const text = verificationFacts({ available: ["ws", "typebox", "prettier"], failures: [] }, true);
  assert.match(text, /no git binary.*pull request files/i);
  assert.match(text, /BusyBox grep lacks --include/);
  assert.match(text, /ws and typebox mounts are source only.*cannot be imported/);
  assert.doesNotMatch(verificationFacts({ available: ["prettier"], failures: [] }, true), /ws and typebox mounts/);
  assert.doesNotMatch(text, /skip/i);
});
test("source cache retries failures and deduplicates simultaneous preparation", async () => {
  let calls = 0;
  const cache = createSourceCache([{ name: "demo" }], async () => {
    calls++;
    return calls === 1
      ? { snapshots: [], failures: ["unavailable"] }
      : { snapshots: [{ manifest: { name: "demo" } }], failures: [] };
  });
  const [first, second] = await Promise.all([cache(), cache()]);
  assert.equal(calls, 1);
  assert.deepEqual(first.failures, second.failures);
  assert.equal((await cache()).snapshots.length, 1);
  assert.equal((await cache()).snapshots.length, 1);
  assert.equal(calls, 2);
});
test("unavailable sources are reported rather than substituted", async () => {
  const result = await prepareSources([{ name: "demo", version: "1.0.0", integrity: "sha512-invalid" }], async () => {
    throw new Error("offline");
  });
  assert.equal(result.snapshots.length, 0);
  assert.match(result.failures[0], /demo.*unavailable/);
});
const sri = (bytes) => "sha512-" + createHash("sha512").update(bytes).digest("base64");
test("reports mismatched package metadata and integrity separately", async () => {
  const bytes = archive("package/package.json", JSON.stringify({ name: "demo", version: "wrong" }));
  const pin = { name: "demo", version: "1.0.0", integrity: sri(bytes) };
  const mismatch = await prepareSources([pin], async () => bytes);
  assert.match(mismatch.failures[0], /version mismatch/);
  const tampered = await prepareSources([pin], async () => Buffer.from("corrupted"));
  assert.match(tampered.failures[0], /integrity verification failed/);
});
test("verifies full artifact before extraction and manifests actual file bytes", () => {
  const bytes = archive("package/index.js", "hello");
  const result = extractVerifiedPackage(bytes, { name: "demo", version: "1.2.3", integrity: sri(bytes) });
  assert.equal(result.files["index.js"].toString(), "hello");
  assert.equal(result.manifest.files["index.js"], createHash("sha256").update("hello").digest("hex"));
  assert.throws(
    () => extractVerifiedPackage(bytes, { name: "demo", version: "1.2.3", integrity: sri(Buffer.from("wrong")) }),
    /integrity/,
  );
  assert.throws(
    () => extractVerifiedPackage(bytes, { name: "demo", version: "1.2.3", integrity: "sha512-bad" }),
    /integrity/,
  );
  for (const name of [
    "package/../secret",
    "/etc/passwd",
    "package/.npmrc",
    "package//a",
    "package/a/",
    "package/a\u0001b",
  ]) {
    const bad = archive(name, "secret");
    assert.throws(
      () => extractVerifiedPackage(bad, { name: "demo", version: "1.2.3", integrity: sri(bad) }),
      /archive/,
    );
  }
  for (const type of ["1", "2", "3", "4", "6", "x"]) {
    const unsafe = archive("package/link", "", type);
    assert.throws(
      () => extractVerifiedPackage(unsafe, { name: "demo", version: "1.2.3", integrity: sri(unsafe) }),
      /archive/,
    );
  }
  const nulName = gunzipSync(archive("package/a", "hello"));
  nulName.write("\0\nzz", 9);
  nulName.fill(32, 148, 156);
  nulName.write(
    [...nulName.subarray(0, 512)]
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  const nulArchive = gzipSync(nulName);
  assert.ok(extractVerifiedPackage(nulArchive, { name: "demo", version: "1.2.3", integrity: sri(nulArchive) }).files.a);
  const parent = gunzipSync(archive("package/a", "hello"));
  const child = gunzipSync(archive("package/a/b", "hello"));
  const clash = gzipSync(Buffer.concat([parent.subarray(0, 1024), child]));
  assert.throws(
    () => extractVerifiedPackage(clash, { name: "demo", version: "1.2.3", integrity: sri(clash) }),
    /archive/i,
  );
  const first = gunzipSync(archive("package/index.js", "hello"));
  const duplicate = gzipSync(Buffer.concat([first.subarray(0, 1024), first]));
  assert.throws(
    () => extractVerifiedPackage(duplicate, { name: "demo", version: "1.2.3", integrity: sri(duplicate) }),
    /Duplicate/,
  );
  first[0] ^= 1;
  const corrupt = gzipSync(first);
  assert.throws(
    () => extractVerifiedPackage(corrupt, { name: "demo", version: "1.2.3", integrity: sri(corrupt) }),
    /checksum/,
  );
  const truncated = gzipSync(first.subarray(0, 512));
  assert.throws(
    () => extractVerifiedPackage(truncated, { name: "demo", version: "1.2.3", integrity: sri(truncated) }),
    /archive/,
  );
});
