import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runtimeFor } from "../../crew-runtime/lib/shared-runtime.mjs";
import { crewEnvironment } from "../../crew-runtime/lib/crew-environment.mjs";
import { assemble } from "./assembly.mjs";
import { compileActorProfile } from "./actor-profile.mjs";
import { BASE_TOOLS_PROFILE } from "./base-tools-profile.mjs";
import { kickoffPayload } from "./kickoff-payload.mjs";
import { suiteGrants } from "./suite-grants.mjs";
import { writeLaunchFiles } from "./launch-files.mjs";
import { resolveLaunchEnvironment } from "./launch-environment.mjs";
export function crewPaths(configDir, runId) {
  const root = join(configDir, "runtime", "crew-launch");
  return {
    roster: join(root, `${runId}-roster.json`),
    selected: join(root, `selected_crew_${runId}.json`),
    config: join(root, `${runId}.json`),
  };
}
const handle = (role, name, ordinal) => `${role}-${name}-${String(ordinal).padStart(2, "0")}`;
const runtimeIdentity = (name, directory) =>
  `## CREW IDENTITY\nYour exact Comm sender handle is ${name}.\n\n## CREW DIRECTORY\n${directory}`;
const workerTask = (actor, runId, topic, directory) =>
  `${actor.instructions}\n\n${runtimeIdentity(actor.handle, directory)}\n\n## SDK CREW RUNTIME\nRUN: ${runId}\nTOPIC: ${topic}\nProcess ordinary Comm deliveries for this selected party. Do not create or inspect roster state. Only Main/Lifecycle removes workers.`;
export function queuedMessage(prepared) {
  return `Crew ${prepared.runId} launched on the SDK runtime.`;
}
export async function prepareCrew(pi, input, ctx, configDir) {
  if (input.completionMode === "human-gated")
    throw new Error("SDK Crew does not yet support scheduled human-gated mode");
  const environment = crewEnvironment(input.environment);
  const runId = crypto.randomUUID();
  const namespace = `crew-${runId}`;
  const topic = `crew.${runId}`;
  const paths = crewPaths(configDir, runId);
  const counts = new Map();
  const actors = input.members.map((member) => {
    const grants = suiteGrants(member.tools ?? BASE_TOOLS_PROFILE);
    if (!member.name?.trim() || !member.role?.trim()) throw new Error("Crew members require name and role.");
    const key = `${member.role}-${member.name}`;
    const ordinal = counts.get(key) ?? 0;
    counts.set(key, ordinal + 1);
    // Only a Lead receives its coordination assignment at session startup.
    // Specialists wait for a directed task after the manifest kickoff.
    const assembled = assemble(member.name, member.role, member.role === "lead" ? member.task ?? "" : "", {
      ...member,
      systemOperations: grants.system,
      runtimeTools: pi.getAllTools(),
    });
    return {
      ...assembled,
      profile: compileActorProfile({ tools: assembled.tools, commTools: assembled.commTools }),
      suiteGrants: grants.suites,
      role: member.role,
      handle: handle(member.role, member.name, ordinal),
    };
  });
  const leads = actors.filter((actor) => actor.role === "lead");
  if (leads.length > 1) throw new Error("A selected Crew may contain at most one lead.");
  const handles = new Set(actors.map((actor) => actor.handle));
  input.members.forEach((member, index) => {
    const dependsOn = member.dependsOn || [];
    const own = actors[index].handle;
    if (dependsOn.some((name) => !handles.has(name) || name === own))
      throw new Error(`Crew member ${own} has an invalid dependsOn reference.`);
    // The Lead is the entry point that hands out the others' work, so it cannot wait on them.
    if (actors[index].role === "lead" && dependsOn.length)
      throw new Error(`The Lead ${own} cannot depend on other members: it assigns their work and integrates their results.`);
  });
  const directory = actors.map((actor) => `- ${actor.handle} (${actor.role})`).join("\n");
  const agents = actors.map((actor) => ({
    name: actor.handle,
    actorId: `${namespace}-${actor.handle}`,
    namespace,
    crewMembers: actors.map((item) => item.handle),
    crewLead: leads[0]?.handle,
    task: workerTask(actor, runId, topic, directory),
    tools: actor.tools,
    commTools: actor.commTools,
    environmentProfile: actor.profile,
    extensionPaths: actor.extensionPaths,
    suiteGrants: actor.suiteGrants,
    model: actor.model,
    thinking: actor.thinking ?? input.thinking,
    resident: true,
    // No role starts a turn at launch: every task, a Lead's included, arrives through
    // dispatch (roots) or dependent release, so a Lead cannot run ahead of its dependencies.
    initialTurn: "first-delivery",
    role: actor.role,
  }));
  const root = join(ctx.cwd, dirname(paths.roster));
  mkdirSync(root, { recursive: true });
  const selected = {
    runId,
    topic,
    environment,
    members: actors.map((actor, index) => ({
      name: actor.name,
      role: actor.role,
      handle: actor.handle,
      tools: actor.tools,
      environmentProfile: actor.profile,
      extensionPaths: actor.extensionPaths,
      model: actor.model,
      thinking: actor.thinking,
      task: String(input.members[index].task || "").trim(),
      dependsOn: input.members[index].dependsOn || [],
      ...(input.members[index].inputs ? { inputs: input.members[index].inputs } : {}),
      ...(input.members[index].deliverTo ? { deliverTo: input.members[index].deliverTo } : {}),
      ...(input.members[index].authority ? { authority: input.members[index].authority } : {}),
      ...(input.members[index].acceptanceCriteria
        ? { acceptanceCriteria: input.members[index].acceptanceCriteria }
        : {}),
      ...(input.members[index].tools ? { tools: input.members[index].tools } : {}),
    })),
  };
  const kickoff = kickoffPayload(runId, topic, selected.members);
  writeLaunchFiles(ctx.cwd, paths, {
    selected,
    roster: { runId, topic, runtime: "sdk", status: "queued", environment, members: [], selectedCrew: paths.selected },
    config: {
      runId,
      topic,
      environment,
      rosterFile: paths.roster,
      agents,
      // Static plan shape (handle/dependsOn/task): the Comm server registers it as the live
      // owner of this run's dependency-ledger status.
      plan: selected.members.map(({ handle, dependsOn, task }) => ({ handle, dependsOn, task })),
      kickoff,
      // External discussion adapters are deferred until after Crew release.
      adapters: [],
    },
  });
  return { runId, topic, rosterFile: paths.roster, configFile: paths.config, selectedCrewFile: paths.selected, agents };
}
export async function launchPreparedCrew(cwd, prepared, dependencies = {}) {
  const configPath = join(cwd, prepared.configFile);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const rosterPath = join(cwd, prepared.rosterFile);
  let roster = JSON.parse(readFileSync(rosterPath, "utf8"));
  if (roster.status !== "queued") return { runId: roster.runId, topic: roster.topic, status: roster.status };
  roster.status = "launching";
  writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
  try {
    const { resolution, agents, credentials } = await resolveLaunchEnvironment(config, dependencies);
    config.agents = agents;
    config.environmentResolution = {
      ...resolution,
      ...(Object.keys(credentials.status).length ? { credentials: credentials.status } : {}),
      ...(credentials.warnings.length ? { warnings: credentials.warnings } : {}),
    };
    roster.environmentResolution = config.environmentResolution;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
    const runtime = (dependencies.runtimeFor ?? runtimeFor)(cwd);
    const namespace = config.agents[0]?.namespace;
    const launched = await runtime.launchCrew(config.agents, config.adapters, {
      namespace,
      members: config.plan ?? [],
    });
    if (config.kickoff) await runtime.broadcast(config.agents[0].namespace, config.kickoff);
    const lead = launched.agents.find(
      (agent) => config.agents.find((item) => item.actorId === agent.id)?.role === "lead",
    );
    roster = JSON.parse(readFileSync(rosterPath, "utf8"));
    Object.assign(roster, {
      status: "started",
      comm: launched.comm,
      lead: lead && { name: lead.name, actorId: lead.id },
      members: launched.agents.map((agent, index) => ({
        name: agent.name,
        actorId: agent.id,
        role: config.agents[index].role,
      })),
    });
    writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
    return {
      runId: roster.runId,
      topic: roster.topic,
      status: "started",
      leadId: lead?.id,
      memberIds: launched.agents.map((agent) => agent.id),
      comm: launched.comm,
      ...(credentials.warnings.length ? { warnings: credentials.warnings } : {}),
    };
  } catch (error) {
    roster.status = "done";
    roster.launchError = String(error);
    writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
    throw error;
  }
}
