import { readFileSync } from "node:fs";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { cachedCatalogWarning, resolveArmoryCatalog } from "../env-runtime/lib/armory-artifacts.mjs";
import { resolveRepositorySeed } from "../env-runtime/lib/repository-workspace.mjs";
import { fetchSuiteExtension } from "./armory-source.mjs";
import { createDispatcher } from "./dispatcher.mjs";
import { loadSuiteModule } from "./github-suite.mjs";
import { createMemberAgent } from "./member-agent.mjs";
import { resolveModel } from "./model.mjs";

const GITHUB_SUITE = "collaboration/pi-github-tools";
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

  async function launch({ runId, crewDir, repository, members, maxParallel, idleMs }) {
    assertOpen();
    if (!runId || crews.has(runId)) throw new Error(`Crew ${runId} already exists`);
    if (!Array.isArray(members) || !members.length) throw new Error("A crew needs at least one member");
    for (const member of members)
      if (!HANDLE.test(member.handle ?? "")) throw new Error(`Invalid member handle: ${member.handle}`);
    for (const member of members)
      for (const grant of member.suiteGrants ?? [])
        if (
          typeof grant?.suite !== "string" ||
          !Array.isArray(grant.operations) ||
          !grant.operations.length ||
          grant.operations.some((operation) => typeof operation !== "string")
        )
          throw new Error(`${member.handle}: a suite grant needs a suite and a list of operations`);
    const activity = new Map();
    // Running totals per member, for Main's footer: they grow while a member works, not only when it reports.
    const live = new Map(members.map((member) => [member.handle, emptyLive()]));
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
          onEvent: (handle, event) => {
            activity.set(handle, { at: Date.now(), type: event.type, ...(event.name ? { name: event.name } : {}) });
            countEvent(live.get(handle), event);
          },
        }),
      onResult: (handle, result) => send({ event: "result", runId, handle, result }),
      onState: (handle, state) => send({ event: "state", runId, handle, state }),
      onIdle: (members) => send({ event: "idle", runId, members }),
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

      assertOpen();
      crews.set(runId, { dispatcher, activity, live });
      registered = true;
      dispatcher.start();
      return {
        runId,
        members: dispatcher.status(),
        ...(crew.github && githubCatalogWarning ? { warnings: [githubCatalogWarning] } : {}),
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
