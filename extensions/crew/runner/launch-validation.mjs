import { NATIVE_TOOLS, validateRequiredCapabilities } from "../crew/lib/required-capabilities.mjs";
import { createDispatcher } from "./dispatcher.mjs";

// role-persona-NN; a persona name may itself contain hyphens (old-major, indiana-docs).
const HANDLE = /^[a-z][a-z0-9]*-[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*-\d{2}$/;

const emptyLive = () => ({
  turns: 0,
  toolCalls: 0,
  toolErrors: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  compactions: 0,
  context: null,
});
function countEvent(live, event) {
  if (!live) return;
  if (event.type === "compaction") live.compactions += 1;
  if (event.type === "tool_start") live.toolCalls += 1;
  if (event.type === "tool_end" && event.error) live.toolErrors += 1;
  if (event.type === "turn") {
    live.turns += 1;
    if (event.context) {
      live.context = {
        percent: event.context.percent ?? live.context?.percent ?? null,
        window: event.context.contextWindow,
      };
    }
    for (const key of ["input", "output", "cacheRead", "cacheWrite"]) live[key] += Number(event.usage?.[key]) || 0;
  }
}

// Validates and prepares every part of a crew launch that can fail before models, repositories, or suites are created.
// Dispatcher construction remains last because it validates dependency ordering and cycles.
export async function validateCrewLaunch({
  runId,
  crewDir,
  repository,
  members,
  maxParallel,
  idleMs,
  preflight,
  scrub,
  send,
  createMemberAgent,
}) {
  if (!Array.isArray(members) || !members.length) throw new Error("A crew needs at least one member");
  for (const member of members)
    if (!HANDLE.test(member.handle ?? "")) throw new Error(`Invalid member handle: ${member.handle}`);
  for (const member of members) {
    if (
      !Array.isArray(member.tools) ||
      member.tools.some((tool) => typeof tool !== "string" || !NATIVE_TOOLS.has(tool))
    )
      throw new Error(`${member.handle}: tools must be an array of recognized native tool names`);
    if (member.suiteGrants !== undefined && !Array.isArray(member.suiteGrants))
      throw new Error(`${member.handle}: suiteGrants must be an array`);
    const seenSuites = new Set();
    for (const grant of member.suiteGrants ?? [])
      if (
        typeof grant?.suite !== "string" ||
        !Array.isArray(grant.operations) ||
        !grant.operations.length ||
        grant.operations.some((operation) => typeof operation !== "string")
      )
        throw new Error(`${member.handle}: a suite grant needs a suite and a list of operations`);
      else if (seenSuites.has(grant.suite)) throw new Error(`${member.handle}: duplicate suite grant: ${grant.suite}`);
      else seenSuites.add(grant.suite);
  }
  for (const member of members)
    validateRequiredCapabilities({
      member: member.handle,
      requiredCapabilities: member.requiredCapabilities,
      tools: member.tools,
      suiteGrants: member.suiteGrants,
    });
  // Every native tool acts in the member's VM: if this machine cannot run one, the launch fails now, with the
  // reason, instead of each member failing when it first touches a tool.
  if (members.some((member) => member.tools?.length)) {
    try {
      await preflight();
    } catch (error) {
      throw new Error(`Crew workers need a Gondolin VM: ${error.message}`);
    }
  }
  const activity = new Map();
  // Running totals per member, for Main's footer: they grow while a member works, not only when it reports.
  const live = new Map(members.map((member) => [member.handle, emptyLive()]));
  const crew = { runId, dir: crewDir, repository, idleMs, settings: undefined };
  const dispatcher = createDispatcher({
    members,
    maxParallel,
    scrub,
    createAgent: (member) =>
      createMemberAgent({
        member,
        crew,
        onEvent: (handle, event) => {
          activity.set(handle, { at: Date.now(), type: event.type, ...(event.name ? { name: event.name } : {}) });
          countEvent(live.get(handle), event);
        },
      }),
    onResult: (handle, result) => send({ event: "result", runId, handle, result }),
    onState: (handle, state) => send({ event: "state", runId, handle, state }),
    onIdle: (members) => send({ event: "idle", runId, members }),
    // Main's hold and handoff decisions are recorded, never delivered as reports: they start no turn.
    onDecision: (handle, decision) => send({ event: "decision", runId, handle, decision }),
  });
  return { activity, live, crew, dispatcher };
}
