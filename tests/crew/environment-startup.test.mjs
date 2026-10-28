import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { launchPreparedCrew, prepareCrew } from "../../.pi/extensions/hall-crew/crew/lib/startup.mjs";

const pi = { getAllTools: () => [] };
const prepare = (cwd, environment) =>
  prepareCrew(
    pi,
    { members: [{ name: "snowball", role: "developer" }], ...(environment && { environment }) },
    { cwd },
    ".pi",
  );

test("prepareCrew records the requested environment in every launch artifact", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd, { microvm: "none" });
    for (const path of [prepared.configFile, prepared.selectedCrewFile, prepared.rosterFile])
      assert.deepEqual(JSON.parse(readFileSync(join(cwd, path), "utf8")).environment, { microvm: "none" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("auto resolves before Runtime creates workers and records its host fallback", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd);
    let launched;
    let kickoff;
    const result = await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => ({ microvm: "none", fallbackReason: "QEMU absent" }),
      runtimeFor: () => ({
        launchCrew: async (agents) => {
          launched = agents;
          return { comm: {}, agents: agents.map((agent) => ({ id: agent.actorId, name: agent.name })) };
        },
        broadcast: async (_namespace, payload) => {
          kickoff = payload;
        },
      }),
    });
    assert.equal(result.status, "started");
    assert.equal(launched[0].sandbox, undefined);
    assert.equal(kickoff.kind, "kickoff");
    assert.equal(kickoff.phase, "manifest");
    assert.deepEqual(kickoff.plan, [{ to: "developer-snowball-00", dependsOn: [] }]);
    for (const path of [prepared.configFile, prepared.rosterFile])
      assert.deepEqual(JSON.parse(readFileSync(join(cwd, path), "utf8")).environmentResolution, {
        microvm: "none",
        fallbackReason: "QEMU absent",
      });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("resolved Gondolin is threaded into every worker launch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd);
    let launched;
    await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => ({ microvm: "gondolin", sandbox: { kind: "gondolin" } }),
      resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
      realizeArmorySuites: async () => [],
      resolveArmoryToolSuites: async () => [],
      runtimeFor: () => ({
        launchCrew: async (agents) => {
          launched = agents;
          return { comm: {}, agents: agents.map((agent) => ({ id: agent.actorId, name: agent.name })) };
        },
        broadcast: async () => {},
      }),
    });
    assert.deepEqual(
      launched.map((agent) => agent.sandbox),
      [{ kind: "gondolin" }],
    );
    assert.deepEqual(launched[0].environmentProfile.suites, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("resolved Gondolin groups Crew-granted GitHub operations before worker launch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      { members: [{ name: "snowball", role: "reviewer", tools: [{ suite: "collaboration/pi-github-tools", operations: ["github_issue_view"] }] }] },
      { cwd },
      ".pi",
    );
    let launched;
    await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => ({ microvm: "gondolin", sandbox: { kind: "gondolin" } }),
      resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
      realizeArmorySuites: async () => [],
      resolveArmoryToolSuites: async ({ requests }) => requests,
      runtimeFor: () => ({
        launchCrew: async (agents) => {
          launched = agents;
          return { comm: {}, agents: agents.map((agent) => ({ id: agent.actorId, name: agent.name })) };
        },
        broadcast: async () => {},
      }),
    });
    assert.deepEqual(launched[0].environmentProfile.builtins, ["read", "grep", "find", "ls", "bash"]);
    assert.equal(launched[0].environmentProfile.suites[0].suite, "collaboration/pi-github-tools");
    assert.equal(launched[0].environmentProfile.suites[0].tools.length, 1);
    assert.ok(launched[0].environmentProfile.suites[0].tools.includes("github_issue_view"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("explicit Gondolin rejects before Runtime can create a worker", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd, { microvm: "gondolin" });
    let runtimeCalled = false;
    await assert.rejects(
      launchPreparedCrew(cwd, prepared, {
        resolveEnvironment: async () => Promise.reject(new Error("QEMU absent")),
        runtimeFor: () => {
          runtimeCalled = true;
          return {};
        },
      }),
      /QEMU absent/,
    );
    assert.equal(runtimeCalled, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("auto falls back to the host with the missing-cache hint when suites cannot be realized", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepare(cwd);
    let launched;
    await launchPreparedCrew(cwd, prepared, {
      resolveEnvironment: async () => ({ microvm: "gondolin", sandbox: { kind: "gondolin" } }),
      resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
      realizeArmorySuites: async () => Promise.reject(new Error("Reason: platform mismatch")),
      explainMissingCache: async (error) => new Error(`Armory cache not configured (run scripts/setup-env.sh); ${error.message}`),
      runtimeFor: () => ({
        launchCrew: async (agents) => {
          launched = agents;
          return { comm: {}, agents: agents.map((agent) => ({ id: agent.actorId, name: agent.name })) };
        },
        broadcast: async () => {},
      }),
    });
    assert.equal(launched[0].sandbox, undefined);
    const { environmentResolution } = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.equal(environmentResolution.microvm, "none");
    assert.match(environmentResolution.fallbackReason, /Armory cache not configured \(run scripts\/setup-env\.sh\)/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

async function launchGithubCrew(cwd) {
  const prepared = await prepareCrew(
    { getAllTools: () => [] },
    { members: [{ name: "snowball", role: "reviewer", tools: [{ suite: "collaboration/pi-github-tools", operations: ["github_issue_view"] }] }] },
    { cwd },
    ".pi",
  );
  const result = await launchPreparedCrew(cwd, prepared, {
    resolveEnvironment: async () => ({ microvm: "gondolin", sandbox: { kind: "gondolin" } }),
    resolveArmoryCatalog: async () => ({ release: "https://example.test/artifacts.json" }),
    realizeArmorySuites: async () => [],
    resolveArmoryToolSuites: async ({ requests }) => requests,
    runtimeFor: () => ({
      launchCrew: async (agents) => ({ comm: {}, agents: agents.map((agent) => ({ id: agent.actorId, name: agent.name })) }),
      broadcast: async () => {},
    }),
  });
  return { prepared, result };
}

async function withToken(value, action) {
  const saved = process.env.HALL_GITHUB_TOKEN;
  if (value === undefined) delete process.env.HALL_GITHUB_TOKEN;
  else process.env.HALL_GITHUB_TOKEN = value;
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    await action(cwd);
  } finally {
    if (saved === undefined) delete process.env.HALL_GITHUB_TOKEN;
    else process.env.HALL_GITHUB_TOKEN = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("a missing token is a launch warning with minting instructions, and the Crew still starts", () =>
  withToken(undefined, async (cwd) => {
    const { prepared, result } = await launchGithubCrew(cwd);
    assert.equal(result.status, "started");
    assert.match(result.warnings[0], /HALL_GITHUB_TOKEN is not set.*personal-access-tokens\/new/s);
    const { environmentResolution } = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.equal(environmentResolution.credentials.HALL_GITHUB_TOKEN, "missing");
    assert.deepEqual(environmentResolution.warnings, result.warnings);
  }));

test("a present token produces no warning and its value is never written down", () =>
  withToken("gho_secret_value", async (cwd) => {
    const { prepared, result } = await launchGithubCrew(cwd);
    assert.equal(result.warnings, undefined);
    for (const path of [prepared.configFile, prepared.rosterFile, prepared.selectedCrewFile])
      assert.doesNotMatch(readFileSync(join(cwd, path), "utf8"), /gho_secret_value/);
    const { environmentResolution } = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.equal(environmentResolution.credentials.HALL_GITHUB_TOKEN, "environment");
  }));
