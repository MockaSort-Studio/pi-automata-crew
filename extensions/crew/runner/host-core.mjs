import { readFileSync } from "node:fs";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveArmoryCatalog } from "../env-runtime/lib/armory-artifacts.mjs";
import { resolveRepositoryDependencyCache } from "../env-runtime/lib/repository-dependency-cache.mjs";
import { resolveRepositorySeed } from "../env-runtime/lib/repository-workspace.mjs";
import { fetchSuiteExtension } from "./armory-source.mjs";
import { createDispatcher } from "./dispatcher.mjs";
import { loadSuiteModule } from "./github-suite.mjs";
import { createMemberAgent } from "./member-agent.mjs";
import { resolveModel } from "./model.mjs";

const GITHUB_SUITE = "collaboration/pi-github-tools";
const HANDLE = /^[a-z][a-z0-9]*-[a-z][a-z0-9]*-\d{2}$/;

const defaults = {
  env: process.env,
  cwd: process.cwd(),
  createModelRuntime: () => ModelRuntime.create(),
  resolveModel,
  // The repository's seed archive for an exact revision, built from the local repository before any VM exists.
  buildSeed: ({ repo, revision }, cwd) => readFileSync(resolveRepositorySeed({ repo, revision }, { cwd })),
  resolveDependencyCache: ({ cwd, profile }) => resolveRepositoryDependencyCache({ cwd, profile }),
  async loadGithubModule() {
    const catalog = await resolveArmoryCatalog();
    return loadSuiteModule(await fetchSuiteExtension({ catalog, suiteId: GITHUB_SUITE }));
  },
  createMemberAgent,
};

// The crew host's brain: the commands Main can send and what they do, independent of how messages travel.
// `send` delivers a message to Main; `deps` replaces anything that touches the outside world (tests).
// Launch validates everything that can be known up front, before any VM exists: the crew's shape, every
// model against Pi's catalog, the repository revision, the Crew credential, the Armory source.
export function createHostCore({ send, deps = {} }) {
  const d = { ...defaults, ...deps };
  const crews = new Map();
  let githubModule;

  const secretsOf = () => [d.env.HALL_GITHUB_TOKEN].filter(Boolean);
  const scrub = (text) => secretsOf().reduce((out, secret) => out.split(secret).join("[redacted]"), String(text));

  async function launch({ runId, crewDir, repository, members, environment = {}, maxParallel, idleMs }) {
    if (!runId || crews.has(runId)) throw new Error(`Crew ${runId} already exists`);
    if (!Array.isArray(members) || !members.length) throw new Error("A crew needs at least one member");
    for (const member of members)
      if (!HANDLE.test(member.handle ?? "")) throw new Error(`Invalid member handle: ${member.handle}`);
    const activity = new Map();
    const crew = { runId, dir: crewDir, repository, idleMs, settings: undefined };

    // The dispatcher validates ordering (unknown prerequisites, cycles, duplicates) as it is built.
    const dispatcher = createDispatcher({
      members,
      maxParallel,
      scrub,
      createAgent: (member) =>
        d.createMemberAgent({
          member,
          crew,
          onEvent: (handle, event) =>
            activity.set(handle, { at: Date.now(), type: event.type, ...(event.name ? { name: event.name } : {}) }),
        }),
      onResult: (handle, result) => send({ event: "result", runId, handle, result }),
      onState: (handle, state) => send({ event: "state", runId, handle, state }),
      onIdle: (members) => send({ event: "idle", runId, members }),
    });

    crew.modelRuntime = await d.createModelRuntime();
    for (const member of members) {
      if (!member.model) continue;
      try {
        d.resolveModel(crew.modelRuntime, member.model);
      } catch (error) {
        throw new Error(`${member.handle}: ${error.message}`);
      }
    }
    if (repository) crew.seedArchive = await d.buildSeed(repository, d.cwd);
    if (members.some((member) => member.suiteGrants?.some((grant) => grant.suite === GITHUB_SUITE))) {
      const token = d.env.HALL_GITHUB_TOKEN;
      if (!token) throw new Error("The GitHub suite is granted but no Crew credential is set (HALL_GITHUB_TOKEN)");
      githubModule ??= await d.loadGithubModule();
      crew.github = { module: githubModule, token };
    }
    if (environment.dependencyCache === "required")
      crew.dependencyCache = d.resolveDependencyCache({ cwd: d.cwd, profile: environment.guestProfile });

    crews.set(runId, { dispatcher, activity });
    dispatcher.start();
    return { runId, members: dispatcher.status() };
  }

  const crewOf = (runId) => {
    const crew = crews.get(runId);
    if (!crew) throw new Error(`Unknown crew: ${runId}`);
    return crew;
  };

  const methods = {
    launch,
    message: async ({ runId, handle, text }) => (crewOf(runId).dispatcher.message(handle, text), { ok: true }),
    cancel: async ({ runId, handle }) => (await crewOf(runId).dispatcher.cancel(handle), { ok: true }),
    status: async ({ runId }) => {
      const { dispatcher, activity } = crewOf(runId);
      return {
        runId,
        members: dispatcher.status().map((member) => ({
          ...member,
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
      await Promise.allSettled([...crews.values()].map(({ dispatcher }) => dispatcher.dispose()));
      crews.clear();
    },
  };
}
