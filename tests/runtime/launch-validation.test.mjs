import { strict as assert } from "node:assert";
import test from "node:test";
import { validateCrewLaunch } from "../../extensions/crew/runner/launch-validation.mjs";

const A = "developer-alpha-00";
const member = (extra = {}) => ({ handle: A, task: "do A", tools: ["read"], suiteGrants: [], dependsOn: [], ...extra });
const launch = (extra = {}) => ({
  runId: "run1",
  members: [member()],
  preflight: async () => {},
  scrub: (text) => text,
  send: () => {},
  createMemberAgent: async () => assert.fail("dispatcher must not start during validation"),
  ...extra,
});

test("launch validation preserves member validation errors before any launch setup", async () => {
  await assert.rejects(validateCrewLaunch(launch({ members: [] })), /A crew needs at least one member/);
  await assert.rejects(
    validateCrewLaunch(launch({ members: [member({ handle: "Not A Handle" })] })),
    /Invalid member handle: Not A Handle/,
  );
  await assert.rejects(
    validateCrewLaunch(launch({ members: [member({ tools: ["not-a-tool"] })] })),
    /developer-alpha-00: tools must be an array of recognized native tool names/,
  );
});

test("launch validation preflights workers before dispatcher dependency validation", async () => {
  const order = [];
  await assert.rejects(
    validateCrewLaunch(
      launch({
        members: [member({ dependsOn: ["developer-bravo-00"] })],
        preflight: async () => order.push("preflight"),
      }),
    ),
    /Unknown dependency ledger node/,
  );
  assert.deepEqual(order, ["preflight"]);
});
