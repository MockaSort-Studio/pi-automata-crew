import { createDependentRelease } from "./dependent-release.mjs";
import { isLead, leadBriefing } from "./lead-briefing.mjs";

const rootTask = (runId, member, extra = {}) => ({ kind: "task", phase: "assignment", runId, task: member.task, ...extra });

// A Lead receives the briefing and hands out the rest; without one, the Crew's roots start and
// the Runtime releases each dependent when its prerequisites complete. `releaseDependents`
// subscribes the release to ledger changes.
export async function dispatchRoots({ runId, members, send, releaseDependents }) {
  const lead = members.find(isLead);
  const initial = lead ? [lead] : members.filter((member) => !member.dependsOn?.length);
  const recipients = await Promise.all(
    initial.map(async (member) => ({
      to: member.handle,
      ...(await send(member.handle, lead ? leadBriefing(runId, lead, members) : rootTask(runId, member))),
    })),
  );
  if (lead) return { dispatched: true, recipients, held: members.filter((m) => m !== lead).map((m) => m.handle), leadLed: true };
  const release = createDependentRelease({
    members,
    released: initial.map((member) => member.handle),
    send: (member) => send(member.handle, rootTask(runId, member, { prerequisites: member.dependsOn })),
  });
  await releaseDependents(release);
  return { dispatched: true, recipients, held: release.held() };
}
