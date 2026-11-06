import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { launchPreparedCrew, prepareCrew } from "../../extensions/crew/crew/lib/startup.mjs";

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

test("prepareCrew records only Gondolin-capable environment selections", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd, { microvm: "gondolin" });
    for (const path of [prepared.configFile, prepared.selectedCrewFile, prepared.rosterFile])
      assert.deepEqual(JSON.parse(readFileSync(join(cwd, path), "utf8")).environment, {
        microvm: "gondolin",
        dependencyCache: "none",
        guestProfile: "gondolin-alpine-node24",
      });
    await assert.rejects(prepare(cwd, { microvm: "none" }), /Unsupported Crew microVM environment/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a required repository cache is resolved before Runtime launches a worker", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd, { dependencyCache: "required" });
    const capture = {};
    await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => gondolin,
      resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
      realizeArmorySuites: async () => [],
      resolveArmoryToolSuites: async () => [],
      resolveRepositoryDependencyCache: ({ cwd: resolvedCwd }) => {
        assert.equal(resolvedCwd, cwd);
        return {
          key: "a".repeat(64),
          profile: "gondolin-alpine-node24",
          modulesPath: "/not-exposed-to-worker-config",
        };
      },
      runtimeFor: () => runtime(capture),
    });
    assert.deepEqual(
      capture.agents.map((agent) => agent.dependencyCache),
      [{ key: "a".repeat(64), profile: "gondolin-alpine-node24" }],
    );
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
