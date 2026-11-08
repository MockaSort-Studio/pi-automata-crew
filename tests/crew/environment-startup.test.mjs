import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { launchPreparedCrew, prepareCrew } from "../../extensions/crew/crew/lib/startup.mjs";
import { resolveLaunchEnvironment } from "../../extensions/crew/crew/lib/launch-environment.mjs";
import { suiteGrants } from "../../extensions/crew/crew/lib/suite-grants.mjs";

const pi = { getAllTools: () => [] };
const prepare = (cwd, environment) =>
  prepareCrew(
    pi,
    { members: [{ name: "snowball", role: "developer" }], ...(environment && { environment }) },
    { cwd },
    ".pi",
  );

const gondolin = { microvm: "gondolin", sandbox: { kind: "gondolin" } };
const runtime = (capture) => ({
  launchCrew: async (agents) => {
    capture.agents = agents;
    return { comm: {}, agents: agents.map((agent) => ({ id: agent.actorId, name: agent.name })) };
  },
  broadcast: async () => {},
});

test("retained launch intersects shared suite resolution with each member's grants", async () => {
  const suite = "example/work";
  const grants = (operations) => suiteGrants([{ suite, operations }]).suites;
  const agents = [
    { name: "developer", tools: ["read"], commTools: ["send"], suiteGrants: grants(["alpha"]) },
    { name: "reviewer", tools: [], suiteGrants: grants(["beta"]) },
    { name: "empty", tools: [] },
    { name: "unresolved", tools: [], suiteGrants: grants(["missing"]) },
  ];
  const requests = agents.flatMap((agent) => agent.suiteGrants ?? []);
  const catalog = { release: "https://example.test/catalog", revision: "abc", fromCache: true, cachedAt: "today" };
  const result = await resolveLaunchEnvironment(
    { agents, runId: "run", environment: { microvm: "gondolin", repository: { repo: "org/repo", revision: "rev", base: "main" } } },
    {
      resolveEnvironment: async () => gondolin,
      resolveArmoryCatalog: async () => catalog,
      realizeArmorySuites: async (input) => assert.deepEqual(input, { catalog, requests }),
      resolveArmoryToolSuites: async (input) => {
        assert.deepEqual(input, { catalog, requests });
        return [{ suite, tools: ["alpha", "beta"] }];
      },
    },
  );
  assert.deepEqual(result.resolution, gondolin);
  for (const [index, expected] of [[0, ["alpha"]], [1, ["beta"]], [2, []], [3, []]]) {
    const agent = result.agents[index];
    const suites = expected.length ? [{ suite, tools: expected }] : [];
    const tools = [...agents[index].tools, ...expected];
    assert.deepEqual(agent.tools, tools);
    assert.deepEqual(agent.environmentProfile, {
      format: "hall.crew-profile/v1", tools, commTools: agents[index].commTools ?? [],
      builtins: agents[index].tools, suites,
    });
    assert.deepEqual(agent.armory, expected.length ? { catalog: { release: catalog.release }, requests: suites } : undefined);
    assert.deepEqual(agent.repositoryAuthorization, {
      repo: "org/repo", revision: "rev", base: "main", branch: `crew/run/${agent.name}`,
    });
    assert.deepEqual(agent.sandbox, gondolin.sandbox);
  }
  assert.deepEqual(result.credentials.status, {});
  assert.match(result.credentials.warnings.join(" "), /cached.*abc.*today/);
});

test("start_crew ignores a stale dependencyCache property", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd, { dependencyCache: "obsolete" });
    const environment = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8")).environment;
    assert.deepEqual(environment, { microvm: "auto" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("prepareCrew records only Gondolin-capable environment selections", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd, { microvm: "gondolin" });
    for (const path of [prepared.configFile, prepared.selectedCrewFile, prepared.rosterFile])
      assert.deepEqual(JSON.parse(readFileSync(join(cwd, path), "utf8")).environment, {
        microvm: "gondolin",
      });
    await assert.rejects(prepare(cwd, { microvm: "none" }), /Unsupported Crew microVM environment/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Crew derives one worker-private branch authorization from immutable repository context", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const revision = "a".repeat(40);
    const prepared = await prepare(cwd, {
      repository: { repo: "MockaSort-Studio/pi-automata-crew", revision, base: "main" },
    });
    const capture = {};
    await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => gondolin,
      resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
      realizeArmorySuites: async () => [],
      resolveArmoryToolSuites: async () => [],
      runtimeFor: () => runtime(capture),
    });
    assert.deepEqual(capture.agents[0].repositoryAuthorization, {
      repo: "MockaSort-Studio/pi-automata-crew",
      revision,
      base: "main",
      branch: `crew/${prepared.runId}/developer-snowball-00`,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Gondolin is threaded into every worker launch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd);
    const capture = {};
    await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => gondolin,
      resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
      realizeArmorySuites: async () => [],
      resolveArmoryToolSuites: async () => [],
      runtimeFor: () => runtime(capture),
    });
    assert.deepEqual(
      capture.agents.map((agent) => agent.sandbox),
      [{ kind: "gondolin" }],
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("preflight and Armory failures occur before Runtime creates a worker", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd);
    let spawned = false;
    await assert.rejects(
      launchPreparedCrew(cwd, prepared, {
        resolveEnvironment: async () => {
          throw new Error("QEMU absent");
        },
        runtimeFor: () => ({
          launchCrew: async () => {
            spawned = true;
          },
        }),
      }),
      /QEMU absent/,
    );
    assert.equal(spawned, false);
    const armoryPrepared = await prepare(cwd);
    await assert.rejects(
      launchPreparedCrew(cwd, armoryPrepared, {
        resolveEnvironment: async () => gondolin,
        resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
        realizeArmorySuites: async () => {
          throw new Error("Armory unavailable");
        },
        runtimeFor: () => ({
          launchCrew: async () => {
            spawned = true;
          },
        }),
      }),
      /Armory unavailable/,
    );
    assert.equal(spawned, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a cached catalog produces a launch warning visible to the caller", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-cache-warning-"));
  try {
    const prepared = await prepare(cwd);
    const launched = await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => gondolin,
      resolveArmoryCatalog: async () => ({
        release: "https://example.test/artifacts.json",
        revision: "abc",
        fromCache: true,
        cachedAt: "2026-01-01T00:00:00.000Z",
      }),
      realizeArmorySuites: async () => [],
      resolveArmoryToolSuites: async () => [],
      runtimeFor: () => runtime({}),
    });
    assert.match(launched.warnings.join(" "), /cached.*abc.*2026-01-01/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
