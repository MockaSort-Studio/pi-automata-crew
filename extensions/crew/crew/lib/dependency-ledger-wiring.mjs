// Adapters between the static selected-Crew plan and the dependency ledger.
// Lifecycle is owned by CommController's typed lifecycle_update API; this
// module deliberately does not observe or interpret free-form envelopes.
import { createDependencyLedger } from "./dependency-ledger.mjs";

export function seedDependencyLedgerFromSelectedCrew(selected, ledger = createDependencyLedger()) {
  const members = Array.isArray(selected?.members) ? selected.members : [];
  for (const member of members) ledger.addNode(member.handle);
  for (const member of members) {
    for (const dependency of member.dependsOn || []) ledger.addDependency(member.handle, dependency);
  }
  return ledger;
}

export function readableDependencyLedgerSnapshot(ledger, members = []) {
  const taskByHandle = new Map(members.map((member) => [member.handle, member.task ?? ""]));
  return ledger.nodes().map((handle) => ({
    handle,
    status: ledger.status(handle),
    dependsOn: ledger.dependenciesOf(handle),
    task: taskByHandle.get(handle) ?? "",
  }));
}

export function ledgerStatusByActor(ledger, members = []) {
  const byActor = {};
  if (!ledger) return byActor;
  for (const member of members) {
    if (member?.actorId && member?.name && ledger.has(member.name))
      byActor[member.actorId] = ledger.status(member.name);
  }
  return byActor;
}
