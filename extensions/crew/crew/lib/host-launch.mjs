import { readFileSync } from "node:fs";
import { join } from "node:path";

const GITHUB_SUITE = "collaboration/pi-github-tools";
const NATIVE_TOOLS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);
const DEFAULT_TASK = "Carry out the assignment described in your instructions.";

// Translates what Crew assembly produced (roles, personas, tool grants, ordering: unchanged) into the launch
// command for the crew host. Only the member's built-in tools go in `tools`; Armory operations stay in
// `suiteGrants`, where the host turns them into the host-side suite.
export function buildLaunchSpec({ config, directory, env = process.env }) {
  const warnings = [];
  const plan = new Map((config.plan ?? []).map((entry) => [entry.handle, entry]));
  const members = config.agents.map((agent) => {
    let suiteGrants = agent.suiteGrants ?? [];
    // The default tool profile includes read-only GitHub access. Without a Crew credential a member that did
    // not ask for GitHub simply goes without it; a member that explicitly asked for it fails the launch.
    if (!env.HALL_GITHUB_TOKEN && !agent.grantsExplicit && suiteGrants.some((grant) => grant.suite === GITHUB_SUITE)) {
      suiteGrants = suiteGrants.filter((grant) => grant.suite !== GITHUB_SUITE);
      warnings.push(`${agent.name}: GitHub tools are unavailable because HALL_GITHUB_TOKEN is not set.`);
    }
    return {
      handle: agent.name,
      instructions: agent.task,
      task: plan.get(agent.name)?.task || DEFAULT_TASK,
      tools: (agent.tools ?? []).filter((tool) => NATIVE_TOOLS.has(tool)),
      suiteGrants,
      model: agent.model,
      thinking: agent.thinking,
      dependsOn: plan.get(agent.name)?.dependsOn ?? [],
    };
  });
  const { repository, dependencyCache, guestProfile } = config.environment ?? {};
  return {
    warnings,
    spec: {
      runId: config.runId,
      crewDir: directory,
      ...(repository ? { repository } : {}),
      environment: { dependencyCache, guestProfile },
      members,
    },
  };
}

// Launches a prepared crew on the host. Everything that can fail up front (models, revision, credentials,
// ordering) fails here, inside the request, before any VM exists.
export async function launchOnHost({ host, prepared, cwd, configDir, env }) {
  const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
  const directory = join(cwd, configDir, "runtime", "crews", config.runId);
  const { spec, warnings } = buildLaunchSpec({ config, directory, env });
  const started = await host.client().request("launch", spec);
  host.track(config.runId, directory);
  return { runId: config.runId, topic: prepared.topic, status: "started", members: started.members, warnings };
}
