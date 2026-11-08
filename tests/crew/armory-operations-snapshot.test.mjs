import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GITHUB_BASE_TOOLS } from "../../extensions/crew/crew/lib/github-base-tools.mjs";

// The snapshot is generated from a released Armory bundle (scripts/snapshot-armory-operations.mjs), so
// authorization work is checked against the real operation inputs, not hand-written mocks.
const snapshot = JSON.parse(readFileSync(new URL("../fixtures/armory-operations.json", import.meta.url), "utf8"));

test("the released-operation snapshot is pinned to a release and a verified bundle hash", () => {
  assert.match(snapshot.revision, /^[0-9a-f]{40}$/);
  assert.match(snapshot.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.suite, "collaboration/pi-github-tools");
});

test("Crew's recognized operation catalog is exactly the released suite's operations", () => {
  assert.deepEqual(Object.keys(snapshot.operations).sort(), [...GITHUB_BASE_TOOLS].sort());
});

test("every released operation names its inputs, and every required input is a declared field", () => {
  for (const [name, operation] of Object.entries(snapshot.operations)) {
    assert.ok(Object.keys(operation.fields).length, name);
    for (const field of operation.required) assert.ok(field in operation.fields, `${name}.${field}`);
  }
});
