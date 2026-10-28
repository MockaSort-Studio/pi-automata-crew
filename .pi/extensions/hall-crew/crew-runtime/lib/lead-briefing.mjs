// A Crew with a Lead is Lead-led: Main briefs only the Lead, which hands each member
// its planned task with `crew_assign`. The broker validates every assignment against
// the same plan, so the briefing is information, not authority.
export const isLead = (member) => member.handle.startsWith("lead-");

export function leadBriefing(runId, lead, members) {
  return {
    kind: "task",
    phase: "assignment",
    runId,
    task: lead.task,
    members: members.filter((member) => member !== lead).map(({ handle, dependsOn, task }) => ({ handle, dependsOn, task })),
    instructions:
      "You are the Crew Lead. Hand out each member's planned task with crew_assign (one call per member; add a short note only when it helps). " +
      "The broker refuses a member whose prerequisites are not complete, one already assigned, and anyone not in this plan. " +
      "Members report to you. When the Crew's work is accepted, report the outcome to Main and call lifecycle_update.",
  };
}
