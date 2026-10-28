import { resolveModelWindow } from "./model-window.mjs";

const number = (value) => (Number.isFinite(value) ? value : 0);

// The worker's own actually-resolved model id, as relayed content-free from
// its live RPC session (see worker-comm-extension.mjs's agent_start handler
// and worker-events.mjs's RESOLVED_MODEL_MARKER). Last one wins, in case a
// future extension of this ever fires more than once per worker.
const resolvedModel = (events) => {
  const records = events.filter((event) => event.type === "resolved_model");
  return records.length ? records[records.length - 1] : null;
};

// Percent of the model's context window consumed by one turn's provider
// request. Uses input + cacheRead + cacheWrite because that trio is what the
// provider actually saw as context for that call (uncached tokens plus
// everything served from cache); output tokens are the response, not context.
const contextTokens = (usage) => number(usage?.input) + number(usage?.cacheRead) + number(usage?.cacheWrite);

const round1 = (value) => Math.round(value * 10) / 10;

export function summarizeWorkerEvents(events, { modelWindow } = {}) {
  const turns = events.filter((event) => event.type === "turn");
  const sum = (field) => turns.reduce((total, event) => total + number(event.usage?.[field]), 0);
  const cacheReads = turns.map((event) => number(event.usage?.cacheRead));
  // An explicit, valid modelWindow always wins (tests rely on this, and a
  // caller with launch-config knowledge of the model may already have one).
  // Otherwise, fall back to what the worker's own session actually reported
  // it was running with -- resolveModelWindow(null) stays null, never a
  // guess, exactly like the explicit-only path already did.
  const resolved = resolvedModel(events);
  const window =
    Number.isFinite(modelWindow) && modelWindow > 0
      ? modelWindow
      : Number.isFinite(resolved?.modelWindow) && resolved.modelWindow > 0
        ? resolved.modelWindow
        : resolveModelWindow(resolved?.modelId);
  const perTurnPercent = turns.map((event) =>
    window === null ? null : round1(Math.min(100, (contextTokens(event.usage) / window) * 100)),
  );
  const knownPercents = perTurnPercent.filter((percent) => percent !== null);
  return {
    turns: turns.length,
    toolCalls: events.filter((event) => event.type === "tool_start").length,
    toolErrors: events.filter((event) => event.type === "tool_end" && event.error).length,
    compactions: events.filter((event) => event.type === "compaction_end").length,
    providerTraffic: {
      uncachedInput: sum("input"),
      generatedOutput: sum("output"),
      cacheRead: sum("cacheRead"),
      cacheWrite: sum("cacheWrite"),
      total: sum("totalTokens"),
      maxCacheReadPerTurn: Math.max(0, ...cacheReads),
    },
    sessionContext: {
      modelWindow: window,
      perTurnPercent,
      lastPercent: perTurnPercent.length ? perTurnPercent[perTurnPercent.length - 1] : null,
      maxPercent: knownPercents.length ? Math.max(...knownPercents) : null,
    },
  };
}
