import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTerminalCrew } from "../../crew/lib/monitor-state.mjs";
import { discussionStateFilePath, postDiscussionClosingComment } from "./github-discussion.mjs";

// After a roster write may have rolled a Crew's terminal state up (either
// member-by-member via roster-lifecycle.mjs, or in a batch via
// roster-terminal.mjs), mirror that onto its GitHub Discussion with one
// idempotent closing comment. Reads each roster fresh from disk rather than
// trusting a caller-supplied before/after status, so it is correct
// regardless of which of those two write paths produced the rollup.
export async function closeTerminalRosterDiscussions(crewLaunchDir, runIds) {
  const results = [];
  for (const runId of new Set(runIds.filter(Boolean))) {
    let roster;
    try {
      roster = JSON.parse(readFileSync(join(crewLaunchDir, `${runId}-roster.json`), "utf8"));
    } catch {
      continue;
    }
    if (!isTerminalCrew(roster)) continue;
    const result = await postDiscussionClosingComment(discussionStateFilePath(crewLaunchDir, runId), {
      status: roster.status,
    });
    results.push({ runId, ...result });
  }
  return results;
}
