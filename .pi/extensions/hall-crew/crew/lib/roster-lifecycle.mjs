// Wires Runtime/Lifecycle worker terminal status into the durable Crew
// lifecycle-state contract (lifecycle-state.mjs) and applies the resulting
// state to a roster member record. Pure mapping/transition logic lives here
// so it is unit-testable without a real Lifecycle/worker process; I/O
// helpers below are the thin, testable seam that touches roster files.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTerminal, transition } from "./lifecycle-state.mjs";
import { isTerminalCrew } from "./monitor-state.mjs";

// LifecycleController.terminalStatus (runtime/lib/lifecycle-controller.mjs)
// only ever reports one of these three worker outcomes. "removed" covers an
// intentional stop, which is durably recorded as a stall nobody resolved
// (BLOCKED) rather than a pass or a failure, matching lifecycle-state.mjs's
// own definition of BLOCKED.
const WORKER_OUTCOMES = Object.freeze({ completed: "PASS", failed: "FAIL", removed: "BLOCKED" });

export function outcomeForWorkerStatus(workerStatus) {
  return WORKER_OUTCOMES[workerStatus] ?? null;
}

// Advances a member's durable lifecycle state to an explicit terminal
// outcome. Routes BLOCKED through "attention" first: running -> BLOCKED is
// not itself a legal edge in the contract, so an intentional stop must pass
// through the same "stalled, unattended" waypoint any other blocked run
// would. A no-op once the member is already terminal.
export function advanceMemberToOutcome(state, outcome) {
  if (!outcome || isTerminal(state)) return state;
  let next = state;
  if (outcome === "BLOCKED" && next !== "attention") next = transition(next, "attention");
  return transition(next, outcome);
}

// Advances one member's durable lifecycle state to the terminal outcome
// implied by a worker's terminal runtime status. This is the automatic,
// infer-from-the-process path -- used when nobody has already recorded what
// the member actually accomplished (see applyMemberOutcomeToRoster below for
// the explicit, Main-declared path).
export function advanceMemberLifecycle(state, workerStatus) {
  return advanceMemberToOutcome(state, outcomeForWorkerStatus(workerStatus));
}

// Every roster member reaching a terminal per-member outcome (PASS/BLOCKED/FAIL)
// rolls the roster up to the single terminal roster-level status "done" -- the
// per-member outcome is the finer-grained detail the footer/dashboard need, the
// roster itself only tracks whether the Crew run is over.
const ROSTER_STATUS_FOR_OUTCOME = Object.freeze({ FAIL: "done", BLOCKED: "done", PASS: "done" });
// Worst-outcome-wins ordering still determines *which* per-member outcome is
// treated as representative when picking a rollup candidate, even though
// every outcome now maps to the same terminal roster status.
const OUTCOME_PRIORITY = Object.freeze(["FAIL", "BLOCKED", "PASS"]);

// Once every roster member has reached a terminal per-member outcome, the
// Crew itself is durably done. Returns null while any member is still
// queued/running/attention, so a roster is never rolled up prematurely --
// this is what lets a multi-member Crew reach a terminal roster status even
// when its workers are stopped one at a time across separate calls, instead
// of only when every member is removed in a single runtime_cleanup batch.
export function rosterStatusForTerminalMembers(members) {
  if (!members.length || !members.every((member) => isTerminal(member.status))) return null;
  const outcome = OUTCOME_PRIORITY.find((candidate) => members.some((member) => member.status === candidate));
  return ROSTER_STATUS_FOR_OUTCOME[outcome];
}

// Pure: returns a new roster object with one member's status advanced by
// `advance(current)`, or the same roster reference if the actor isn't a
// member or `advance` is a no-op. Members default to "running" the first
// time they receive a status: prepareCrew/launchPreparedCrew record only
// "queued" launch-time roster status, not a per-member lifecycle state.
// Also rolls the roster-level status up to a terminal Crew status once this
// update makes every member terminal, so the Crew monitor can retire it.
function applyMemberAdvance(roster, actorId, advance) {
  const members = roster?.members || [];
  const index = members.findIndex((member) => member.actorId === actorId);
  if (index === -1) return roster;
  const current = members[index].status ?? "running";
  const next = advance(current);
  if (next === current) return roster;
  const updated = [...members];
  updated[index] = { ...updated[index], status: next };
  const rollup = isTerminalCrew(roster) ? null : rosterStatusForTerminalMembers(updated);
  return { ...roster, members: updated, ...(rollup ? { status: rollup } : {}) };
}

// I/O: applies `advance` to one actor's member entry in every roster file in
// crewLaunchDir that lists it as a member, mirroring
// terminalizeRostersForRemovedActors's scan pattern in roster-terminal.mjs.
function applyMemberAdvanceToFiles(crewLaunchDir, actorId, advance) {
  let names;
  try {
    names = readdirSync(crewLaunchDir).filter((name) => name.endsWith("-roster.json"));
  } catch {
    return [];
  }
  const updated = [];
  for (const name of names) {
    const path = join(crewLaunchDir, name);
    const roster = JSON.parse(readFileSync(path, "utf8"));
    const next = applyMemberAdvance(roster, actorId, advance);
    if (next === roster) continue;
    writeFileSync(path, JSON.stringify(next, null, 2));
    updated.push({ runId: roster.runId, actorId, status: next.members.find((m) => m.actorId === actorId).status });
  }
  return updated;
}

// Automatic path: infers the outcome from a worker process's terminal
// runtime status (completed/failed/removed). Use when nobody has already
// recorded what the member accomplished.
export function applyWorkerStatusToRoster(roster, actorId, workerStatus) {
  return applyMemberAdvance(roster, actorId, (current) => advanceMemberLifecycle(current, workerStatus));
}
export function applyWorkerStatusToRosterFiles(crewLaunchDir, actorId, workerStatus) {
  return applyMemberAdvanceToFiles(crewLaunchDir, actorId, (current) => advanceMemberLifecycle(current, workerStatus));
}

// Explicit path: Main has already received and accepted (or rejected) a
// member's report and is declaring the outcome directly, instead of letting
// it be inferred from the worker process's removal status. This is what
// lets a member that reported done and was then intentionally removed land
// on PASS instead of the removal-inferred BLOCKED.
export function applyMemberOutcomeToRoster(roster, actorId, outcome) {
  return applyMemberAdvance(roster, actorId, (current) => advanceMemberToOutcome(current, outcome));
}
export function applyMemberOutcomeToRosterFiles(crewLaunchDir, actorId, outcome) {
  return applyMemberAdvanceToFiles(crewLaunchDir, actorId, (current) => advanceMemberToOutcome(current, outcome));
}
