import { resolveCrewEnvironment } from "../../crew-runtime/lib/crew-environment.mjs";
import { resolveArmoryCatalog } from "../../env-runtime/lib/armory-artifacts.mjs";
import { acquireNixGuestSuites, explainMissingCache, resolveNixGuestSuiteRequests } from "../../env-runtime/lib/armory-nix.mjs";
import { checkLaunchCredentials } from "../../env-runtime/lib/credentials.mjs";
import { compileActorProfile } from "./actor-profile.mjs";
import { realizeOrFallback } from "./armory-fallback.mjs";

// Decides how a Crew runs (Gondolin or host), fetches the Armory suites a sandbox needs, and
// gives each agent its resolved tools and profile. Only whether each credential is present is
// recorded, never its value.
export async function resolveLaunchEnvironment(config, dependencies = {}) {
  const suiteRequests = config.agents.flatMap((agent) => agent.suiteGrants ?? []);
  let catalog;
  const resolution = await realizeOrFallback(
    await (dependencies.resolveEnvironment ?? resolveCrewEnvironment)(config.environment),
    config.environment.microvm,
    async () => {
      try {
        catalog = await (dependencies.resolveArmoryCatalog ?? resolveArmoryCatalog)();
        await (dependencies.realizeArmorySuites ?? acquireNixGuestSuites)({ catalog, requests: suiteRequests });
      } catch (error) {
        throw await (dependencies.explainMissingCache ?? explainMissingCache)(error);
      }
    },
  );
  const suiteTools = resolution.sandbox
    ? await (dependencies.resolveArmoryToolSuites ?? resolveNixGuestSuiteRequests)({ catalog, requests: suiteRequests })
    : [];
  const agents = config.agents.map((agent) => {
    const suites = suiteTools.filter((suite) => (agent.suiteGrants ?? []).some((grant) => grant.suite === suite.suite));
    const tools = [...new Set([...(agent.tools ?? []), ...suites.flatMap((suite) => suite.tools)])];
    const environmentProfile = compileActorProfile({ tools, commTools: agent.commTools ?? [], suites });
    return {
      ...agent,
      tools,
      environmentProfile,
      ...(resolution.sandbox && environmentProfile.suites.length
        ? { armory: { catalog: { release: catalog.release }, requests: environmentProfile.suites.map(({ suite, tools }) => ({ suite, tools })) } }
        : {}),
      ...(resolution.sandbox ? { sandbox: resolution.sandbox } : {}),
    };
  });
  const suiteIds = [...new Set(agents.flatMap((agent) => agent.environmentProfile.suites.map((suite) => suite.suite)))];
  const credentials = resolution.sandbox ? checkLaunchCredentials({ suiteIds }) : { status: {}, warnings: [] };
  return { resolution, agents, credentials };
}
