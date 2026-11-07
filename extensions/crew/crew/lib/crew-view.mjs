import { crewMonitorSnapshot } from "./monitor-snapshot.mjs";
import { buildPlanTab } from "./monitor-dashboard.mjs";
import { renderCrewStatusFooter } from "./monitor-footer.mjs";

// What Main's footer and dashboard show for a crew running on the crew host. Pure: the host's `status` answer
// and the launch plan go in; the existing snapshot, footer and dashboard renderers are fed from them.
const LIFECYCLE = {
  queued: "queued",
  held: "queued",
  running: "running",
  needs_input: "attention",
  failed: "attention",
  completed: "PASS",
  cancelled: "FAIL",
};
const LEDGER = { completed: "complete", cancelled: "failed", needs_input: "blocked", failed: "blocked" };
const ENDED = new Set(["completed", "cancelled"]);
const short = (runId) => String(runId).slice(0, 8);

const metricsOf = (live = {}) => ({
  turns: live.turns,
  toolCalls: live.toolCalls,
  toolErrors: live.toolErrors,
  ...(live.context && {
    sessionContext: {
      lastPercent: live.context.percent == null ? null : Math.round(live.context.percent),
      modelWindow: live.context.window,
    },
  }),
  providerTraffic: {
    uncachedInput: live.input,
    generatedOutput: live.output,
    cacheRead: live.cacheRead,
    cacheWrite: live.cacheWrite,
  },
});

export const isActive = (members) => members.some((member) => !ENDED.has(member.state));

export function crewView({ runId, members }) {
  const lifecycleByActor = {};
  const workerMetricsByActor = {};
  for (const member of members) {
    lifecycleByActor[member.handle] = LIFECYCLE[member.state] ?? "queued";
    workerMetricsByActor[member.handle] = metricsOf(member.live);
  }
  const roster = { runId: short(runId), members: members.map(({ handle }) => ({ actorId: handle, name: handle })) };
  const snapshot = crewMonitorSnapshot(roster, { lifecycleByActor, workerMetricsByActor });
  const phase = members.some((m) => m.state === "running")
    ? "Working"
    : members.some((m) => m.state === "needs_input" || m.state === "failed")
      ? "Needs you"
      : isActive(members)
        ? "Queued"
        : "Done";
  return { runId, snapshot, line: { view: { runId: short(runId), phase }, footer: renderCrewStatusFooter(snapshot) } };
}

// The Plan tab: the assignment each member was given, in order, with its live status.
export function planRows({ plan, members }) {
  const ledgerSnapshot = members.map((member) => ({
    handle: member.handle,
    status: member.state === "queued" || member.state === "held" ? member.ledger : (LEDGER[member.state] ?? "running"),
  }));
  return buildPlanTab({ selectedCrew: { members: plan }, ledgerSnapshot });
}

export const pickerItem = ({ runId, members }) => ({
  value: runId,
  label: `Crew ${short(runId)} · ${crewView({ runId, members }).line.view.phase}`,
  description: `${members.length} member${members.length === 1 ? "" : "s"}`,
});
