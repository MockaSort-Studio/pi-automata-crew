import { crewMonitorSnapshot } from "./monitor-snapshot.mjs";
import { buildPlanTab } from "./monitor-dashboard.mjs";
import { renderCrewStatusFooter } from "./monitor-footer.mjs";

// What Main's footer and dashboard show for a crew running on the crew host. Pure: the host's `status` answer
// and the launch plan go in; the existing snapshot, footer and dashboard renderers are fed from them.
const LIFECYCLE = {
  queued: "queued",
  // Not started because a prerequisite is blocked, failed or handed off: it cannot progress on its own.
  held: "BLOCKED",
  running: "running",
  ci: "running",
  needs_input: "attention",
  failed: "attention",
  // Main acknowledged it; someone else owns the blocker.
  on_hold: "BLOCKED",
  completed: "PASS",
  // Ended without acceptance: its dependents stay blocked, so it is never shown as passed.
  handed_off: "BLOCKED",
  cancelled: "FAIL",
};
const LEDGER = {
  completed: "complete",
  cancelled: "failed",
  needs_input: "blocked",
  failed: "blocked",
  on_hold: "blocked",
  handed_off: "blocked",
};
const ENDED = new Set(["completed", "handed_off", "cancelled"]);
const short = (runId) => String(runId).slice(0, 8);

const metricsOf = (live = {}) => ({
  turns: live.turns,
  toolCalls: live.toolCalls,
  toolErrors: live.toolErrors,
  compactions: live.compactions,
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
  const phase = members.some((m) => m.state === "running" || m.state === "ci")
    ? "Working"
    : members.some((m) => m.state === "needs_input" || m.state === "failed")
      ? "Needs you"
      : members.some((m) => m.state === "on_hold")
        ? "On hold"
        : members.some((m) => m.state === "queued")
          ? "Queued"
          : members.some((m) => m.state === "handed_off")
            ? "Handed off"
            : members.some((m) => m.state === "held")
              ? "Blocked"
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
