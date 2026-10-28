import { strict as assert } from "node:assert";
import test from "node:test";
import { summarizeWorkerEvents } from "../../.pi/extensions/hall-crew/crew-runtime/lib/worker-metrics.mjs";

const turns = [
  { type: "turn", usage: { input: 10, output: 20, cacheRead: 100, cacheWrite: 30, totalTokens: 160 } },
  { type: "turn", usage: { input: 11, output: 21, cacheRead: 200, cacheWrite: 31, totalTokens: 263 } },
  { type: "tool_start" },
  { type: "tool_end", error: true },
  { type: "compaction_end" },
];

test("separates provider traffic from unique-token claims", () => {
  const metrics = summarizeWorkerEvents(turns);
  assert.deepEqual(metrics, {
    turns: 2,
    toolCalls: 1,
    toolErrors: 1,
    compactions: 1,
    providerTraffic: {
      uncachedInput: 21,
      generatedOutput: 41,
      cacheRead: 300,
      cacheWrite: 61,
      total: 423,
      maxCacheReadPerTurn: 200,
    },
    sessionContext: {
      modelWindow: null,
      perTurnPercent: [null, null],
      lastPercent: null,
      maxPercent: null,
    },
  });
});

test("records per-turn session context percent against the model's context window", () => {
  const metrics = summarizeWorkerEvents(turns, { modelWindow: 1000 });
  // turn 1: (10 input + 100 cacheRead + 30 cacheWrite) / 1000 = 14%
  // turn 2: (11 input + 200 cacheRead + 31 cacheWrite) / 1000 = 24.2%
  assert.deepEqual(metrics.sessionContext, {
    modelWindow: 1000,
    perTurnPercent: [14, 24.2],
    lastPercent: 24.2,
    maxPercent: 24.2,
  });
});

test("ignores a non-positive or non-finite modelWindow", () => {
  assert.equal(summarizeWorkerEvents(turns, { modelWindow: 0 }).sessionContext.modelWindow, null);
  assert.equal(summarizeWorkerEvents(turns, { modelWindow: -5 }).sessionContext.modelWindow, null);
  assert.equal(summarizeWorkerEvents(turns, { modelWindow: NaN }).sessionContext.modelWindow, null);
});

test("derives modelWindow from a resolved_model event when no explicit modelWindow is given", () => {
  const events = [
    { type: "resolved_model", modelId: "anthropic/claude-sonnet-4-6" },
    { type: "turn", usage: { input: 20_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 20_000 } },
  ];
  const metrics = summarizeWorkerEvents(events);
  // claude-sonnet-4-6's known window is 200_000: 20_000 / 200_000 = 10%.
  assert.equal(metrics.sessionContext.modelWindow, 200_000);
  assert.equal(metrics.sessionContext.lastPercent, 10);
});

test("uses the worker-reported modelWindow even when the model id is not catalogued", () => {
  const events = [
    { type: "resolved_model", modelId: "anthropic/claude-sonnet-5", modelWindow: 200_000 },
    { type: "turn", usage: { input: 20_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 20_000 } },
  ];
  const metrics = summarizeWorkerEvents(events);
  assert.equal(metrics.sessionContext.modelWindow, 200_000);
  assert.equal(metrics.sessionContext.lastPercent, 10);
});

test("stays null when the resolved model id is unknown, never guessing a window", () => {
  const events = [{ type: "resolved_model", modelId: "some-future-model-nobody-has-catalogued" }, ...turns];
  assert.equal(summarizeWorkerEvents(events).sessionContext.modelWindow, null);
});

test("an explicit modelWindow still wins over a resolved_model event", () => {
  const events = [
    { type: "resolved_model", modelId: "anthropic/claude-sonnet-4-6" },
    { type: "turn", usage: { input: 500, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 500 } },
  ];
  const metrics = summarizeWorkerEvents(events, { modelWindow: 1000 });
  assert.equal(metrics.sessionContext.modelWindow, 1000);
});

test("clamps context percent at 100 when usage exceeds the model window", () => {
  const metrics = summarizeWorkerEvents(
    [{ type: "turn", usage: { input: 5000, cacheRead: 0, cacheWrite: 0, output: 0, totalTokens: 5000 } }],
    { modelWindow: 1000 },
  );
  assert.deepEqual(metrics.sessionContext.perTurnPercent, [100]);
});
