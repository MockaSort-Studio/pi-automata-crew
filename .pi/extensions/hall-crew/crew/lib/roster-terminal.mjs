import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTerminalCrew } from "./monitor-state.mjs";

export function terminalizeRoster(roster) {
  if (isTerminalCrew(roster)) return roster;
  return { ...roster, status: "done", members: [] };
}

// Runtime cleanup/removal tears down specific SDK workers by actorId. A
// durable Crew roster is fully torn down -- and must be terminalized -- only
// when every member it still lists was among the actors Runtime just
// removed. Partial removals (e.g. one specialist) leave the roster
// untouched so the Lead's normal crew_unregister/crew_finish_close
// handshake still governs it. Callers pass the already-resolved
// crew-launch directory; this module never reads cwd or env itself.
export function terminalizeRostersForRemovedActors(crewLaunchDir, removedActorIds) {
  const removed = new Set(removedActorIds);
  let names;
  try {
    names = readdirSync(crewLaunchDir).filter((name) => name.endsWith("-roster.json"));
  } catch {
    return [];
  }
  const terminalized = [];
  for (const name of names) {
    const path = join(crewLaunchDir, name);
    const roster = JSON.parse(readFileSync(path, "utf8"));
    if (isTerminalCrew(roster)) continue;
    const members = roster.members || [];
    if (!members.length || !members.every((member) => removed.has(member.actorId))) continue;
    writeFileSync(path, JSON.stringify(terminalizeRoster(roster), null, 2));
    terminalized.push(roster.runId);
  }
  return terminalized;
}
