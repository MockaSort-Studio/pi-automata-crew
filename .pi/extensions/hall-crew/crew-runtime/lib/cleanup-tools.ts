import { Type } from "typebox";
import { applyMemberOutcomeToRosterFiles, applyWorkerStatusToRosterFiles } from "../../crew/lib/roster-lifecycle.mjs";
import { terminalizeRostersForRemovedActors } from "../../crew/lib/roster-terminal.mjs";
import { reapOrphans } from "./lifecycle-registry.mjs";
import { closeTerminalRosterDiscussions } from "./roster-discussion-close.mjs";

// A worker already reached a natural terminal status (completed/failed)
// before removal reaches it; LifecycleController.remove() always finalizes
// to "removed" regardless, so the pre-removal snapshot is the only place
// that natural outcome is still observable. Only "removed" reflects a
// genuinely intentional stop.
const workerStatusForRoster = (before: any, removalStatus: string) => {
  const typed = { complete: "completed", blocked: "removed", failed: "failed" }[before?.lifecycleStatus];
  return typed ?? (before?.found && (before.status === "completed" || before.status === "failed") ? before.status : removalStatus);
};

const closeDiscussionsFor = (crewLaunch: string, rosterLifecycleUpdates: any[], terminalizedRosters: string[]) =>
  closeTerminalRosterDiscussions(crewLaunch, [
    ...rosterLifecycleUpdates.map((update: any) => update.runId),
    ...terminalizedRosters,
  ]);

// Registers the tools that remove workers/worktrees and roll their durable
// roster/Discussion state forward to a terminal status: runtime_cleanup,
// runtime_reap_orphans, and runtime_delete_agent. Split out of index.ts so
// that file stays a thin tool registrar instead of growing with every piece
// of cleanup/terminal-rollup behavior.
export function registerCleanupTools(pi: any, runtime: any, crewLaunchDir: (cwd: string) => string): void {
  pi.registerTool({
    name: "runtime_cleanup",
    label: "Runtime: cleanup",
    description: "Remove every SDK worker and worktree owned by this Runtime session.",
    parameters: Type.Object({}),
    async execute() {
      const processList = await runtime.list();
      const beforeList = await Promise.all(processList.map((agent: any) => runtime.inspect(agent.id)));
      const result = await runtime.stop();
      const removedIds = result.removals.filter((item: any) => item.removed && item.id).map((item: any) => item.id);
      const rosterLifecycleUpdates = removedIds.flatMap((id: string) => {
        const before = beforeList.find((agent: any) => agent.id === id);
        const removal = result.removals.find((item: any) => item.id === id);
        return applyWorkerStatusToRosterFiles(
          crewLaunchDir(process.cwd()),
          id,
          workerStatusForRoster(before, removal?.status ?? "removed"),
        );
      });
      const terminalizedRosters = terminalizeRostersForRemovedActors(crewLaunchDir(process.cwd()), removedIds);
      const discussionClosures = await closeDiscussionsFor(
        crewLaunchDir(process.cwd()),
        rosterLifecycleUpdates,
        terminalizedRosters,
      );
      const details = { ...result, terminalizedRosters, rosterLifecycleUpdates, discussionClosures };
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  });
  pi.registerTool({
    name: "runtime_reap_orphans",
    label: "Runtime: reap orphaned Lifecycle servers",
    description:
      "Terminate lifecycle-server.mjs processes left behind by Main sessions that no longer exist, using their durable owner/PID records. Only touches a record whose host process is confirmed gone.",
    parameters: Type.Object({}),
    async execute() {
      const reaped = await reapOrphans(process.cwd());
      return { content: [{ type: "text", text: JSON.stringify({ reaped }) }], details: { reaped } };
    },
  });
  pi.registerTool({
    name: "runtime_delete_agent",
    label: "Runtime: delete agent",
    description: "Stop an SDK agent and remove its worktree.",
    parameters: Type.Object({
      id: Type.String(),
      // Set this when Main has already received and accepted (or rejected)
      // this member's report before removing it, so the roster records what
      // actually happened instead of the removal-inferred BLOCKED ("stalled
      // unattended") -- e.g. a resident worker that reported done and is now
      // simply being cleaned up should land on PASS, not BLOCKED.
      outcome: Type.Optional(Type.Union([Type.Literal("PASS"), Type.Literal("FAIL"), Type.Literal("BLOCKED")])),
    }),
    async execute(_id: unknown, input: any) {
      const before = await runtime.inspect(input.id);
      const result = await runtime.remove(input.id);
      const rosterLifecycleUpdates = result.removed
        ? input.outcome
          ? applyMemberOutcomeToRosterFiles(crewLaunchDir(process.cwd()), input.id, input.outcome)
          : applyWorkerStatusToRosterFiles(
              crewLaunchDir(process.cwd()),
              input.id,
              workerStatusForRoster(before, result.status ?? "removed"),
            )
        : [];
      const terminalizedRosters = result.removed
        ? terminalizeRostersForRemovedActors(crewLaunchDir(process.cwd()), [input.id])
        : [];
      const discussionClosures = await closeDiscussionsFor(
        crewLaunchDir(process.cwd()),
        rosterLifecycleUpdates,
        terminalizedRosters,
      );
      const details = { ...result, terminalizedRosters, rosterLifecycleUpdates, discussionClosures };
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  });
}
