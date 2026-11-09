import { strict as assert } from "node:assert";
import test from "node:test";
import { disposeMember } from "../../extensions/crew/runner/member-agent.mjs";

test("a member's VM is closed even when its session's disposal throws synchronously", async () => {
  let closed = 0;
  const environment = { close: async () => (closed += 1) };
  const run = {
    dispose() {
      throw new Error("session dispose failed");
    },
  };
  await assert.rejects(disposeMember(run, environment), /session dispose failed/, "the failure is still reported");
  assert.equal(closed, 1);
  await disposeMember({ dispose() {} }, environment);
  assert.equal(closed, 2);
});
