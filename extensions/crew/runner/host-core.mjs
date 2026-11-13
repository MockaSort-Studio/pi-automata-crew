import { readFileSync } from "node:fs";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { cachedCatalogWarning, resolveArmoryCatalog } from "../env-runtime/lib/armory-artifacts.mjs";
import { resolveRepositorySeed } from "../env-runtime/lib/repository-workspace.mjs";
import { fetchSuiteExtension } from "./armory-source.mjs";
import { prepareDependencySources } from "./dependency-mount.mjs";
import { loadSuiteModule } from "./github-suite.mjs";
import { createMemberAgent } from "./member-agent.mjs";
import { resolveModel } from "./model.mjs";
import { preflightWorkerSandbox } from "../env-runtime/lib/sandbox-preflight.mjs";
import { validateCrewLaunch } from "./launch-validation.mjs";

const GITHUB_SUITE = "collaboration/pi-github-tools";
const defaults = {
  env: process.env,
  cwd: process.cwd(),
  createModelRuntime: () => ModelRuntime.create(),
  resolveModel,
  // The repository's seed archive for an exact revision, built from the local repository before any VM exists.
  buildSeed: ({ repo, revision }, cwd) => readFileSync(resolveRepositorySeed({ repo, revision }, { cwd })),
  resolveArmoryCatalog,
  async loadGithubModule(catalog) {
    return loadSuiteModule(await fetchSuiteExtension({ catalog, suiteId: GITHUB_SUITE }));
  },
  createMemberAgent,
  prepareDependencySources,
  preflight: () => preflightWorkerSandbox({ sandbox: { kind: "gondolin" } }),
};

// The crew host's brain: the commands Main can send and what they do, independent of how messages travel.
// `send` delivers a message to Main; `deps` replaces anything that touches the outside world (tests).
// Launch validates everything that can be known up front, before any VM exists: the crew's shape, every
// model against Pi's catalog, the repository revision, the Crew credential, the Armory source.
export function createHostCore({ send, deps = {} }) {
  const d = { ...defaults, ...deps };
  const crews = new Map();
  let githubModule;
  let githubCatalogWarning;
  let closing = false;
  const assertOpen = () => {
    if (closing) throw new Error("The crew host is closing");
  };

  const secretsOf = () => [d.env.HALL_GITHUB_TOKEN].filter(Boolean);
  const scrub = (text) => secretsOf().reduce((out, secret) => out.split(secret).join("[redacted]"), String(text));

  // A run id is reserved from the moment its launch starts, so two concurrent launches cannot both pass the check.
  const reserved = new Set();
  async function launch(params) {
    assertOpen();
    const { runId } = params;
    if (!runId || crews.has(runId) || reserved.has(runId)) throw new Error(`Crew ${runId} already exists`);
    reserved.add(runId);
    try {
      return await startCrew(params);
    } finally {
      reserved.delete(runId);
    }
  }

  async function startCrew({ runId, crewDir, repository, members, maxParallel, idleMs }) {
    const { activity, live, crew, dispatcher } = await validateCrewLaunch({
      runId,
      crewDir,
      repository,
      members,
      maxParallel,
      idleMs,
      preflight: () => d.preflight(),
      scrub,
      send,
      createMemberAgent: (options) => d.createMemberAgent(options),
    });

    let registered = false;
    try {
      crew.modelRuntime = await d.createModelRuntime();
      assertOpen();
      for (const member of members) {
        if (!member.model) continue;
        try {
          d.resolveModel(crew.modelRuntime, member.model);
        } catch (error) {
          throw new Error(`${member.handle}: ${error.message}`);
        }
      }
      if (repository) crew.seedArchive = await d.buildSeed(repository, d.cwd);
      assertOpen();
      if (members.some((member) => member.suiteGrants?.some((grant) => grant.suite === GITHUB_SUITE))) {
        const token = d.env.HALL_GITHUB_TOKEN;
        if (!token) throw new Error("The GitHub suite is granted but no Crew credential is set (HALL_GITHUB_TOKEN)");
        if (!githubModule) {
          const catalog = await d.resolveArmoryCatalog();
          assertOpen();
          githubModule = await d.loadGithubModule(catalog);
          githubCatalogWarning = cachedCatalogWarning(catalog);
        }
        assertOpen();
        crew.github = { module: githubModule, token };
      }

      const warnings = crew.github && githubCatalogWarning ? [githubCatalogWarning] : [];
      if (members.some((member) => member.tools?.includes("bash"))) {
        try {
          const sources = await d.prepareDependencySources();
          warnings.push(...sources.failures.map((failure) => `Guest dependency source: ${failure}`));
        } catch {
          warnings.push("Guest dependency sources unavailable; dependency-backed verification may require hosted CI");
        }
      }
      assertOpen();
      crews.set(runId, { dispatcher, activity, live });
      registered = true;
      dispatcher.start();
      return {
        runId,
        members: dispatcher.status(),
        ...(warnings.length ? { warnings } : {}),
      };
    } finally {
      if (!registered) {
        await dispatcher.dispose();
        await crew.modelRuntime?.dispose?.();
      }
    }
  }

  const crewOf = (runId) => {
    const crew = crews.get(runId);
    if (!crew) throw new Error(`Unknown crew: ${runId}`);
    return crew;
  };

  const methods = {
    launch,
    message: async ({ runId, handle, text }) => (crewOf(runId).dispatcher.message(handle, text), { ok: true }),
    hold: async ({ runId, handle, blocker, owner, resumeWhen, refs }) => ({
      hold: crewOf(runId).dispatcher.hold(handle, { blocker, owner, resumeWhen, refs }),
    }),
    handoff: async ({ runId, handle, unmet, supersededBy, note }) => ({
      handoff: await crewOf(runId).dispatcher.handoff(handle, { unmet, supersededBy, note }),
    }),
    cancel: async ({ runId, handle }) => (await crewOf(runId).dispatcher.cancel(handle), { ok: true }),
    status: async ({ runId }) => {
      const { dispatcher, activity, live } = crewOf(runId);
      return {
        runId,
        members: dispatcher.status().map((member) => ({
          ...member,
          live: live.get(member.handle),
          ...(activity.has(member.handle) ? { lastActivity: activity.get(member.handle) } : {}),
        })),
      };
    },
    list: async () => ({ crews: [...crews.keys()] }),
    dispose: async ({ runId }) => {
      await crewOf(runId).dispatcher.dispose();
      crews.delete(runId);
      return { ok: true };
    },
  };

  return {
    async handle(message) {
      const { id, method, params = {} } = message ?? {};
      try {
        if (!methods[method]) throw new Error(`Unknown method: ${method}`);
        send({ id, ok: true, result: await methods[method](params) });
      } catch (error) {
        send({ id, ok: false, error: { message: scrub(error?.message ?? error) } });
      }
    },
    // Closes every VM; called when Main goes away or asks the host to stop.
    async close() {
      closing = true;
      let timer;
      await Promise.race([
        Promise.allSettled([...crews.values()].map(({ dispatcher }) => dispatcher.dispose())),
        new Promise((resolve) => (timer = setTimeout(resolve, 10000))),
      ]);
      clearTimeout(timer);
      crews.clear();
    },
  };
}
