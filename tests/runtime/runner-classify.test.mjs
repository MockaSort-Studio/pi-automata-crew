import { strict as assert } from "node:assert";
import test from "node:test";
import { classifyRun } from "../../extensions/crew/runner/classify-run.mjs";
import { resolveModel } from "../../extensions/crew/runner/model.mjs";
import { providerFailureCategory } from "../../extensions/crew/runner/provider-failure.mjs";

const assistant = (overrides = {}) => ({
  role: "assistant",
  content: [{ type: "text", text: "all done" }],
  stopReason: "stop",
  usage: { input: 10, output: 5 },
  ...overrides,
});

test("a normal final message with text is completed, with usage and tool counts", () => {
  const result = classifyRun({
    messages: [
      assistant({ content: [{ type: "toolCall", name: "bash" }], stopReason: "toolUse" }),
      { role: "toolResult", isError: true },
      assistant(),
    ],
  });
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "all done");
  assert.deepEqual(
    { turns: result.usage.turns, toolCalls: result.usage.toolCalls, toolErrors: result.usage.toolErrors },
    { turns: 2, toolCalls: 1, toolErrors: 1 },
  );
});

test("an empty final turn is a failure regardless of usage, never a success", () => {
  for (const usage of [
    { input: 0, output: 0 },
    { input: 50, output: 9 },
  ])
    assert.deepEqual(classifyRun({ messages: [assistant({ content: [], usage })] }).failure, {
      category: "empty_turn",
    });
  assert.equal(classifyRun({ messages: [] }).failure.category, "empty_turn");
});

test("provider errors keep a fixed category and only the HTTP status, never the provider's text", () => {
  const result = classifyRun({
    messages: [assistant({ content: [], stopReason: "error", errorMessage: '429: {"key":"sk-secret-123"}' })],
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.failure, { category: "rate_limit_or_quota", httpStatus: 429 });
  assert.doesNotMatch(JSON.stringify(result), /sk-secret/);
});

test("the runner's own facts outrank the final message: input requests and cancellations", () => {
  const aborted = [assistant({ content: [], stopReason: "aborted", errorMessage: "Request aborted" })];
  assert.equal(classifyRun({ messages: aborted, cancelled: true }).status, "cancelled");
  assert.equal(
    classifyRun({ messages: aborted }).failure.category,
    "aborted",
    "an abort nobody asked for is a failure",
  );
  const asked = classifyRun({ messages: aborted, inputRequest: { question: "which file?" }, cancelled: true });
  assert.deepEqual([asked.status, asked.question], ["needs_input", "which file?"]);
});

test("truncated, unfinished and thrown runs are failures with their own categories", () => {
  assert.equal(classifyRun({ messages: [assistant({ stopReason: "length" })] }).failure.category, "output_limit");
  assert.equal(classifyRun({ messages: [assistant({ stopReason: "toolUse" })] }).failure.category, "incomplete");
  assert.equal(classifyRun({ messages: [assistant()], thrown: new Error("boom") }).failure.category, "runtime_error");
});

const catalog = [
  { provider: "a", id: "m1" },
  { provider: "b", id: "m1" },
  { provider: "a", id: "m2" },
];
const runtime = { getModel: (p, i) => catalog.find((m) => m.provider === p && m.id === i), getModels: () => catalog };

test("models resolve exactly against the catalog; sentinels, unknown and ambiguous references are rejected", () => {
  assert.equal(resolveModel(runtime, "a/m1"), catalog[0]);
  assert.equal(resolveModel(runtime, "m2"), catalog[2]);
  assert.throws(() => resolveModel(runtime, "inherit"), /not model IDs/);
  assert.throws(() => resolveModel(runtime, ""), /not model IDs/);
  assert.throws(() => resolveModel(runtime, "m1"), /several providers/);
  assert.throws(() => resolveModel(runtime, "a/nope"), /not found/);
});

test("provider failure categories", () => {
  const category = (errorMessage) => providerFailureCategory({ stopReason: "error", errorMessage });
  assert.equal(category("401 bad key"), "authentication_or_permission");
  assert.equal(category("rate limit reached"), "rate_limit_or_quota");
  assert.equal(category("503 overloaded"), "provider_unavailable");
  assert.equal(category("model not found"), "model_not_found");
  assert.equal(category("who knows"), "provider_error");
  assert.equal(providerFailureCategory({ stopReason: "stop", errorMessage: "429" }), undefined);
});
