import { strict as assert } from "node:assert";
import test from "node:test";
import { scanForSecret } from "./github-ci-secret-scan.mjs";

test("secret scan identifies each leaking artifact independently", () => {
  const token = "dummy-secret";
  const clean = { workspaceTar: Buffer.from("workspace"), seedArchive: Buffer.from("seed"), runRecords: ["record"] };
  assert.deepEqual(scanForSecret(token, clean), []);
  assert.deepEqual(scanForSecret(token, { ...clean, workspaceTar: Buffer.from(token) }), ["workspaceTar"]);
  assert.deepEqual(scanForSecret(token, { ...clean, seedArchive: Buffer.from(token) }), ["seedArchive"]);
  assert.deepEqual(scanForSecret(token, { ...clean, runRecords: [{ stdout: token }] }), ["runRecords"]);
});
