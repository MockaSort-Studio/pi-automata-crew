import { strict as assert } from "node:assert";
import test from "node:test";
import { realizeOrFallback } from "../../.pi/extensions/hall-crew/crew/lib/armory-fallback.mjs";

const gondolin = { microvm: "gondolin", sandbox: { kind: "gondolin" } };
const fail = async () => {
  throw new Error("Cannot build npm-deps.drv\nReason: platform mismatch");
};

test("keeps Gondolin when suites realize", async () => {
  assert.deepEqual(await realizeOrFallback(gondolin, "auto", async () => {}), gondolin);
});

test("auto falls back to the host with the stated reason", async () => {
  const result = await realizeOrFallback(gondolin, "auto", fail);
  assert.equal(result.microvm, "none");
  assert.equal(result.sandbox, undefined);
  assert.match(result.fallbackReason, /Armory guest suites unavailable: Reason: platform mismatch$/);
});

test("explicit gondolin reports the failure instead of degrading", async () => {
  await assert.rejects(realizeOrFallback(gondolin, "gondolin", fail), /platform mismatch/);
});

test("a host-only resolution never tries to realize suites", async () => {
  const host = { microvm: "none" };
  assert.equal(await realizeOrFallback(host, "auto", () => assert.fail("must not realize")), host);
});

test("prefers Nix's stderr reason over the generic command failure", async () => {
  const nixFailure = async () => {
    throw Object.assign(new Error("Command failed: nix build ..."), {
      stderr: "copying path\nerror: Cannot build x.drv.\n       Reason: platform mismatch\n",
    });
  };
  const result = await realizeOrFallback(gondolin, "auto", nixFailure);
  assert.match(result.fallbackReason, /Reason: platform mismatch$/);
});
