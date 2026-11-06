import { strict as assert } from "node:assert";
import test from "node:test";
import { realizeOrFallback } from "../../extensions/crew/crew/lib/armory-fallback.mjs";

const gondolin = { microvm: "gondolin", sandbox: { kind: "gondolin" } };
const fail = async () => {
  throw new Error("Cannot build npm-deps.drv\nReason: platform mismatch");
};

test("keeps Gondolin when suites realize", async () => {
  assert.deepEqual(await realizeOrFallback(gondolin, "auto", async () => {}), gondolin);
});

test("unrealizable suites fail instead of falling back to the host", async () => {
  await assert.rejects(realizeOrFallback(gondolin, "auto", fail), /platform mismatch/);
});

test("a host-only resolution is refused before suite realization", async () => {
  await assert.rejects(
    realizeOrFallback({ microvm: "none" }, "auto", () => assert.fail("must not realize")),
    /Gondolin sandbox is required/,
  );
});
