// Pure CrewMonitorSnapshot projection: durable roster + per-actor lifecycle
// state + worker metrics already on disk, folded into one compact view.
// No I/O here; callers load the roster JSON, lifecycle-state values, and
// worker-metrics.mjs summaries and pass them in.
import { STATES, TERMINAL_OUTCOMES, isTerminal } from "./lifecycle-state.mjs";

const BUCKET_FOR_STATE = Object.freeze({
  queued: "queued",
  waiting: "waiting",
  running: "running",
  attention: "attention",
  PASS: "complete",
  BLOCKED: "blocked",
  FAIL: "failed",
});

const KNOWN_STATES = new Set([...STATES, ...TERMINAL_OUTCOMES]);

// A roster member has no durable "running" write path today: roster-lifecycle.mjs
// only records terminal PASS/BLOCKED/FAIL at worker removal, so an actor that
// has actually started work still reads back as the "queued" default forever.
// When no explicit lifecycle entry is recorded, fall back to live worker-metrics
// evidence (turns or tool calls > 0) to distinguish "running" from "queued".
function hasLiveActivity(actorId, workerMetricsByActor) {
  const metric = workerMetricsByActor?.[actorId];
  const turns = metric?.turns;
  const toolCalls = metric?.toolCalls;
  return (Number.isFinite(turns) && turns > 0) || (Number.isFinite(toolCalls) && toolCalls > 0);
}

// A member's roster-recorded lifecycle status only ever advances when Main
// explicitly reconciles it (records an outcome, or removes/infers one on
// stop) -- see roster-lifecycle.mjs. A worker's own completion report
// updates the dependency ledger live (dependency-ledger-wiring.mjs's
// taskStatus handling) well before Main gets around to that, so a finished
// member would otherwise read back as "running" indefinitely, waiting on a
// Main-side action nothing guarantees happens promptly. When there is no
// explicit roster entry, prefer the ledger's own terminal call over the
// weaker live-activity heuristic below.
const BUCKET_FOR_LEDGER_STATUS = Object.freeze({ complete: "complete", blocked: "blocked", failed: "failed" });

function bucketFor(actorId, lifecycleByActor, workerMetricsByActor, ledgerStatusByActor) {
  const recorded = lifecycleByActor[actorId];
  if (recorded) {
    if (!KNOWN_STATES.has(recorded)) throw new Error(`Unknown Crew lifecycle state: ${recorded}`);
    return BUCKET_FOR_STATE[recorded];
  }
  const ledgerBucket = BUCKET_FOR_LEDGER_STATUS[ledgerStatusByActor?.[actorId]];
  if (ledgerBucket) return ledgerBucket;
  return hasLiveActivity(actorId, workerMetricsByActor) ? "running" : "queued";
}

function generatedOutputFor(actorId, workerMetricsByActor) {
  const metric = workerMetricsByActor?.[actorId];
  const value = metric?.providerTraffic?.generatedOutput;
  return Number.isFinite(value) ? value : 0;
}

const number = (value) => (Number.isFinite(value) ? value : 0);

// "percent / model window" is the dashboard's compact session-context cell:
// worker-metrics.mjs already computes both halves per actor (sessionContext
// .lastPercent and .modelWindow); this just renders the pair, or an em-dash
// placeholder when either half is not yet known (no turns, or no configured
// window for that model).
export function formatTokenCount(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return String(value);
}

export function formatSessionContext(sessionContext) {
  const percent = sessionContext?.lastPercent;
  const window = sessionContext?.modelWindow;
  const percentLabel = Number.isFinite(percent) ? `${percent}%` : "—";
  return `${percentLabel} / ${formatTokenCount(window)}`;
}

// One dashboard row's worth of per-automaton detail, folding a roster
// member's identity + durable lifecycle bucket together with whatever
// worker-metrics.mjs summary is on disk for it right now. Pure: no I/O,
// no default-to-"queued" reinterpretation of bucketFor's own logic.
function automatonDetail(member, actorId, bucket, workerMetricsByActor) {
  const metric = workerMetricsByActor?.[actorId] ?? {};
  const traffic = metric.providerTraffic ?? {};
  return {
    actorId,
    name: member?.name ?? actorId,
    bucket,
    turns: number(metric.turns),
    toolCalls: number(metric.toolCalls),
    toolErrors: number(metric.toolErrors),
    compactions: number(metric.compactions),
    providerTraffic: {
      uncachedInput: number(traffic.uncachedInput),
      generatedOutput: number(traffic.generatedOutput),
      cacheRead: number(traffic.cacheRead),
      cacheWrite: number(traffic.cacheWrite),
    },
    sessionContext: formatSessionContext(metric.sessionContext),
  };
}

export function crewMonitorSnapshot(
  roster,
  { lifecycleByActor = {}, workerMetricsByActor = {}, ledgerStatusByActor = {} } = {},
) {
  if (!roster) return null;
  const members = Array.isArray(roster.members) ? roster.members : [];

  const counts = { queued: 0, waiting: 0, running: 0, attention: 0, complete: 0, blocked: 0, failed: 0, total: 0 };
  let totalGeneratedOutputTokens = 0;
  let maxContextPercent = null;
  const contextWindows = new Set();
  const automata = [];

  for (const member of members) {
    const actorId = member?.actorId;
    const bucket = bucketFor(actorId, lifecycleByActor, workerMetricsByActor, ledgerStatusByActor);
    counts[bucket] += 1;
    counts.total += 1;
    totalGeneratedOutputTokens += generatedOutputFor(actorId, workerMetricsByActor);
    const sessionContext = workerMetricsByActor?.[actorId]?.sessionContext;
    if (Number.isFinite(sessionContext?.lastPercent))
      maxContextPercent = Math.max(maxContextPercent ?? 0, sessionContext.lastPercent);
    if (Number.isFinite(sessionContext?.modelWindow)) contextWindows.add(sessionContext.modelWindow);
    automata.push(automatonDetail(member, actorId, bucket, workerMetricsByActor));
  }

  return {
    runId: String(roster.runId ?? "unknown"),
    counts,
    totalGeneratedOutputTokens,
    contextSummary: { maxPercent: maxContextPercent, modelWindows: [...contextWindows] },
    automata,
  };
}

// Re-exported so callers building lifecycleByActor can validate raw values
// against the same durable vocabulary this projection enforces.
export { isTerminal };
