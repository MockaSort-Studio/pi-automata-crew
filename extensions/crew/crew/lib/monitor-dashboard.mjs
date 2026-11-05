// Pure data shaping for the expandable Crew dashboard's two tabs. No I/O:
// callers load the CrewMonitorSnapshot (monitor-snapshot.mjs), the durable
// selected_crew_<uuid>.json member list, and (when a live dependency ledger
// is wired up) dependency-ledger-wiring.mjs's readable snapshot, then pass
// them in here. Never derives rows from report/prose text.

// The Automata tab is already exactly the per-actor detail rows
// monitor-snapshot.mjs computes; this just names the contract so monitor.ts
// does not reach into snapshot internals directly.
export function buildAutomataTab(snapshot) {
  return Array.isArray(snapshot?.automata) ? snapshot.automata : [];
}

// The Plan tab is one row per statically-declared Crew member: task text
// and dependsOn edges come from selected_crew_<uuid>.json (the only durable
// record of the plan shape); live status comes from a dependency ledger
// snapshot when one is available, keyed by the same `handle` used there.
// A member absent from the ledger snapshot (no live ledger wired yet, or a
// handle the ledger has not seen) reports "unknown" rather than guessing.
export function buildPlanTab({ selectedCrew, ledgerSnapshot = [] } = {}) {
  const members = Array.isArray(selectedCrew?.members) ? selectedCrew.members : [];
  const statusByHandle = new Map(ledgerSnapshot.map((entry) => [entry.handle, entry.status]));

  return members.map((member) => ({
    task: member.task ?? "",
    status: statusByHandle.get(member.handle) ?? "unknown",
    assignedAutomaton: member.handle,
    dependsOn: member.dependsOn ?? [],
  }));
}
