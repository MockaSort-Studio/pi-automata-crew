import { strict as assert } from "node:assert";
import test from "node:test";
import { crewEnvironment, resolveCrewEnvironment } from "../../extensions/crew/crew/lib/crew-environment.mjs";

test("auto selects Gondolin after one successful preflight", async () => {
  const calls = [];
  const resolved = await resolveCrewEnvironment(
    { microvm: "auto" },
    { preflight: async (config) => calls.push(config) },
  );
  assert.deepEqual(calls, [{ sandbox: { kind: "gondolin" } }]);
  assert.deepEqual(resolved, { microvm: "gondolin", sandbox: { kind: "gondolin" } });
});

test("unavailable Gondolin fails closed for auto and explicit requests", async () => {
  for (const microvm of ["auto", "gondolin"]) {
    await assert.rejects(
      resolveCrewEnvironment({ microvm }, { preflight: async () => Promise.reject(new Error("QEMU absent")) }),
      /Gondolin sandbox is required.*QEMU absent/,
    );
  }
});

test("validates repository environment", () => {
  assert.deepEqual(crewEnvironment({ microvm: "gondolin" }), { microvm: "gondolin" });
  assert.throws(
    () => crewEnvironment({ repository: { repo: "invalid", revision: "a".repeat(40), base: "main" } }),
    /repository/,
  );
});

test("rejects host and malformed environment selections", () => {
  assert.throws(() => crewEnvironment("none"), /Unsupported Crew microVM environment/);
  assert.throws(() => crewEnvironment({ microvm: "none" }), /Unsupported Crew microVM environment/);
  assert.throws(() => crewEnvironment({ microvm: "host" }), /Unsupported Crew microVM environment/);
});
