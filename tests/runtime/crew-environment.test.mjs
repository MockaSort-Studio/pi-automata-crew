import { strict as assert } from "node:assert";
import test from "node:test";
import { crewEnvironment, resolveCrewEnvironment } from "../../.pi/extensions/hall-crew/crew-runtime/lib/crew-environment.mjs";

test("auto selects Gondolin after one successful preflight", async () => {
  const calls = [];
  const resolved = await resolveCrewEnvironment(
    { microvm: "auto" },
    { preflight: async (config) => calls.push(config) },
  );
  assert.deepEqual(calls, [{ sandbox: { kind: "gondolin" } }]);
  assert.deepEqual(resolved, { microvm: "gondolin", sandbox: { kind: "gondolin" } });
});

test("auto records a host fallback when Gondolin is unavailable", async () => {
  const resolved = await resolveCrewEnvironment(
    { microvm: "auto" },
    { preflight: async () => Promise.reject(new Error("QEMU absent")) },
  );
  assert.deepEqual(resolved, { microvm: "none", fallbackReason: "QEMU absent" });
});

test("explicit Gondolin rejects instead of creating a host fallback", async () => {
  await assert.rejects(
    resolveCrewEnvironment(
      { microvm: "gondolin" },
      { preflight: async () => Promise.reject(new Error("QEMU absent")) },
    ),
    /QEMU absent/,
  );
});

test("rejects malformed environment selections", () => {
  assert.throws(() => crewEnvironment("none"), /Unsupported Crew microVM environment/);
  assert.throws(() => crewEnvironment({ microvm: "host" }), /Unsupported Crew microVM environment/);
});

test("none never probes Gondolin", async () => {
  const resolved = await resolveCrewEnvironment(
    { microvm: "none" },
    { preflight: () => assert.fail("must not probe") },
  );
  assert.deepEqual(resolved, { microvm: "none" });
});
