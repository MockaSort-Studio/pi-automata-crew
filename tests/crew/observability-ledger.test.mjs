import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assistantTextTokens,
  staticContextTokens,
  toolCallTokens,
  toolKind,
  toolResultTokens,
  toolWindowTotals,
} from "../../.pi/extensions/hall-crew/crew/lib/observability-ledger.mjs";

test("ledger records native tool calls with model-facing token estimates", () => {
  assert.equal(toolKind("comm_notify"), "native");
  assert.ok(toolCallTokens("comm_notify", { message: "evidence" }) > 0);
  assert.equal(toolResultTokens({ content: [{ type: "text", text: "abc" }] }), 1);
  assert.equal(assistantTextTokens({ content: [{ type: "text", text: "abcd" }] }), 1);
});

test("ledger keeps static and window totals separate", () => {
  assert.equal(staticContextTokens("abcd", [{ name: "comm_notify", parameters: {} }]).systemPrompt, 1);
  assert.deepEqual(
    toolWindowTotals([
      { kind: "native", callTokens: 2, resultTokens: 3 },
      { kind: "native", callTokens: 5, resultTokens: 7 },
    ]),
    { calls: 7, results: 10, count: 2 },
  );
});
