import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderCrewStatusFooter } from "../../.pi/extensions/hall-crew/crew/lib/monitor-footer.mjs";

const snapshot = (overrides) => ({
  runId: "run-123456",
  counts: { queued: 1, running: 2, attention: 0, complete: 1, blocked: 0, failed: 0, total: 4 },
  totalGeneratedOutputTokens: 4200,
  contextSummary: { maxPercent: 12.5, modelWindows: [200_000] },
  ...overrides,
});

test("renderCrewStatusFooter is a compact single line with automaton counts and output tokens", () => {
  const line = renderCrewStatusFooter(snapshot());
  assert.equal(typeof line, "string");
  assert.equal(line.includes("\n"), false);
  assert.match(line, /4 automata/);
  assert.match(line, /2 running/);
  assert.match(line, /1 queued/);
  assert.match(line, /1 complete/);
  assert.match(line, /4\.2k output tokens/);
});

test("renderCrewStatusFooter contains no context telemetry segment", () => {
  const line = renderCrewStatusFooter(snapshot());
  assert.equal(line.includes("context"), false);
  assert.equal(line.includes("maxPercent"), false);
});

test("renderCrewStatusFooter omits zero-count buckets to stay compact", () => {
  const line = renderCrewStatusFooter(snapshot());
  assert.equal(line.includes("attention"), false);
  assert.equal(line.includes("blocked"), false);
  assert.equal(line.includes("failed"), false);
});

test("renderCrewStatusFooter never mentions cost, money, queue depth, or inflight abbreviations", () => {
  const line = renderCrewStatusFooter(snapshot({ counts: { ...snapshot().counts, blocked: 1, failed: 1 } }));
  assert.equal(/\$|cost|inflight|qty/i.test(line), false);
});

test("renderCrewStatusFooter formats large output token counts with compact k/M notation", () => {
  const line = renderCrewStatusFooter(snapshot({ totalGeneratedOutputTokens: 1_234_567 }));
  assert.match(line, /1\.2M output tokens/);
  const line2 = renderCrewStatusFooter(snapshot({ totalGeneratedOutputTokens: 999 }));
  assert.match(line2, /999 output tokens/);
});

test("renderCrewStatusFooter handles a null snapshot as an empty string", () => {
  assert.equal(renderCrewStatusFooter(null), "");
});

test("renderCrewStatusFooter handles an all-zero snapshot", () => {
  const line = renderCrewStatusFooter(
    snapshot({
      counts: { queued: 0, running: 0, attention: 0, complete: 0, blocked: 0, failed: 0, total: 0 },
      totalGeneratedOutputTokens: 0,
    }),
  );
  assert.match(line, /0 automata/);
  assert.match(line, /0 output tokens/);
  assert.equal(line.includes("context"), false);
});
