import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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

// Bounds. Each archive below is otherwise valid, so removing the bound under test makes extraction succeed.
const MiB = 1024 * 1024;
const demoPin = (bytes) => ({ name: "demo", version: "1.2.3", integrity: sri(bytes) });
const tarEntries = (count, name = (i) => `package/d${i}`) =>
  Buffer.concat(Array.from({ length: count }, (_, i) => gunzipSync(archive(name(i), "", "5")).subarray(0, 512)));
const terminated = (tar) => gzipSync(Buffer.concat([tar, Buffer.alloc(1024)]));

test("an archive over 32 MiB is refused before it is hashed or unpacked", () => {
  const big = archive("package/blob", randomBytes(33 * MiB));
  assert.ok(big.length > 32 * MiB);
  assert.throws(() => extractVerifiedPackage(big, demoPin(big)), /Invalid dependency integrity/);
  const small = archive("package/blob", randomBytes(MiB));
  assert.equal(extractVerifiedPackage(small, demoPin(small)).files.blob.length, MiB);
});

test("a gzip bomb over 128 MiB unpacked is refused", () => {
  const bomb = archive("package/zeros", Buffer.alloc(129 * MiB));
  assert.ok(bomb.length < MiB, "the bomb is small on the wire");
  assert.throws(() => extractVerifiedPackage(bomb, demoPin(bomb)), /Invalid dependency archive/);
});

test("an archive with more than 12000 entries is refused", () => {
  const limit = terminated(tarEntries(12000));
  assert.equal(Object.keys(extractVerifiedPackage(limit, demoPin(limit)).manifest.files).length, 0);
  const over = terminated(tarEntries(12001));
  assert.throws(() => extractVerifiedPackage(over, demoPin(over)), /exceeds bounds/);
});

const streamingGet = (chunks, seen = []) => {
  return (options, callback) => {
    seen.push(options);
    const request = new EventEmitter();
    request.destroy = () => {};
    const response = new EventEmitter();
    response.statusCode = 200;
    queueMicrotask(() => {
      callback(response);
      for (const chunk of chunks) response.emit("data", chunk);
      response.emit("end");
    });
    return request;
  };
};

test("a registry download over 32 MiB is refused; one at the bound is kept", async () => {
  const chunk = Buffer.alloc(MiB);
  await assert.rejects(
    downloadArtifact(DEPENDENCY_PINS[0], { get: streamingGet([...Array(32).fill(chunk), Buffer.alloc(1)]) }),
    /exceeds bounds/,
  );
  const atBound = await downloadArtifact(DEPENDENCY_PINS[0], { get: streamingGet(Array(32).fill(chunk)) });
  assert.equal(atBound.length, 32 * MiB);
});

test("only reviewed pins are downloaded, from the fixed registry origin and path", async () => {
  const seen = [];
  const get = streamingGet([Buffer.from("x")], seen);
  const [pin] = DEPENDENCY_PINS;
  for (const unknown of [
    { ...pin, integrity: sri(Buffer.from("other")) },
    { ...pin, version: "0.0.1" },
    { ...pin, name: "evil" },
    { name: "evil", version: "1.0.0", integrity: pin.integrity },
  ])
    await assert.rejects(downloadArtifact(unknown, { get }), /Unknown dependency pin/);
  assert.equal(seen.length, 0, "an unknown pin never reaches the network");
  for (const reviewed of DEPENDENCY_PINS) await downloadArtifact(reviewed, { get });
  assert.deepEqual(
    seen,
    DEPENDENCY_PINS.map((reviewed) => ({
      hostname: "registry.npmjs.org",
      path: `/${reviewed.name}/-/${reviewed.name.split("/").at(-1)}-${reviewed.version}.tgz`,
      headers: { accept: "application/octet-stream" },
      agent: false,
    })),
  );
  assert.ok(seen.some((options) => options.path === "/@earendil-works/gondolin/-/gondolin-0.14.0.tgz"));
  assert.ok(seen.some((options) => options.path === "/prettier/-/prettier-3.5.3.tgz"));
});
