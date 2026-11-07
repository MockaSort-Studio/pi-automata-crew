import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareCrew } from "../../extensions/crew/crew/lib/startup.mjs";
import { buildLaunchSpec, launchOnHost } from "../../extensions/crew/crew/lib/host-launch.mjs";

const GITHUB = "collaboration/pi-github-tools";
const agent = (name, extra = {}) => ({
  name,
  task: `instructions for ${name}`,
  tools: ["read", "bash", "github_issue_view", "comm_notify"],
  // The shape Crew assembly really produces: { suite, tools }.
  suiteGrants: [{ suite: GITHUB, tools: ["github_issue_view"] }],
  grantsExplicit: false,
  model: "openai-codex/gpt-6.1-terra",
  thinking: undefined,
  ...extra,
});
const config = (agents, extra = {}) => ({
  runId: "11111111-1111-1111-1111-111111111111",
  agents,
  plan: agents.map((a, i) => ({
    handle: a.name,
    dependsOn: i ? [agents[0].name] : [],
    task: i ? "" : "the assignment",
  })),
  environment: {
    repository: { repo: "o/r", revision: "a".repeat(40), base: "main" },
  },
  ...extra,
});

test("assembly output becomes a host launch: instructions, assignment, ordering, repository, environment", () => {
  const { spec, warnings } = buildLaunchSpec({
    config: config([agent("developer-a-00"), agent("reviewer-b-00")]),
    directory: "/crews/x",
    env: { HALL_GITHUB_TOKEN: "t" },
  });
  assert.deepEqual(warnings, []);
  assert.equal(spec.runId, "11111111-1111-1111-1111-111111111111");
  assert.equal(spec.crewDir, "/crews/x");
  assert.deepEqual(spec.repository, { repo: "o/r", revision: "a".repeat(40), base: "main" });
  assert.equal(spec.environment, undefined);
  const [a, b] = spec.members;
  assert.deepEqual(
    [a.handle, a.instructions, a.task, a.dependsOn],
    ["developer-a-00", "instructions for developer-a-00", "the assignment", []],
  );
  assert.deepEqual(b.dependsOn, ["developer-a-00"]);
  assert.match(b.task, /^Carry out the assignment/, "a member without task text still gets a prompt");
  assert.equal(a.model, "openai-codex/gpt-6.1-terra");
});

test("only built-in tools are routed as tools; Armory operations stay grants, and Comm tools are gone", () => {
  const { spec } = buildLaunchSpec({
    config: config([agent("developer-a-00")]),
    directory: "/d",
    env: { HALL_GITHUB_TOKEN: "t" },
  });
  assert.deepEqual(spec.members[0].tools, ["read", "bash"]);
  assert.deepEqual(spec.members[0].suiteGrants, [{ suite: GITHUB, operations: ["github_issue_view"] }]);
});

test("without a Crew credential the default GitHub grant is dropped with a warning; an explicit one is kept to fail the launch", () => {
  const agents = [agent("developer-a-00"), agent("developer-b-00", { grantsExplicit: true })];
  const { spec, warnings } = buildLaunchSpec({ config: config(agents), directory: "/d", env: {} });
  assert.deepEqual(spec.members[0].suiteGrants, []);
  assert.equal(spec.members[1].suiteGrants.length, 1, "the host refuses it with a clear error");
  assert.deepEqual(warnings, ["developer-a-00: GitHub tools are unavailable because HALL_GITHUB_TOKEN is not set."]);
});

test("launching sends the spec to the host, tracks the run, and reports the members", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-launch-"));
  try {
    const c = config([agent("developer-a-00")]);
    mkdirSync(join(cwd, ".pi/runtime/crew-launch"), { recursive: true });
    writeFileSync(join(cwd, ".pi/runtime/crew-launch/x.json"), JSON.stringify(c));
    const rosterPath = join(cwd, ".pi/runtime/crew-launch/x-roster.json");
    const roster = () => JSON.parse(readFileSync(rosterPath, "utf8"));
    writeFileSync(rosterPath, JSON.stringify({ runId: c.runId, status: "queued", members: [] }));
    const requests = [];
    const tracked = [];
    const host = {
      client: () => ({
        request: async (method, params) => (
          requests.push([method, params]), { members: [{ handle: "developer-a-00", state: "running" }] }
        ),
      }),
      track: (...args) => tracked.push(args),
    };
    const result = await launchOnHost({
      host,
      prepared: {
        configFile: ".pi/runtime/crew-launch/x.json",
        rosterFile: ".pi/runtime/crew-launch/x-roster.json",
        topic: "crew.t",
      },
      cwd,
      configDir: ".pi",
      env: { HALL_GITHUB_TOKEN: "t" },
    });
    assert.equal(requests[0][0], "launch");
    assert.equal(requests[0][1].crewDir, join(cwd, ".pi/runtime/crews", c.runId));
    assert.deepEqual(tracked, [
      [
        c.runId,
        join(cwd, ".pi/runtime/crews", c.runId),
        [
          {
            handle: "developer-a-00",
            task: "the assignment",
            dependsOn: [],
          },
        ],
      ],
    ]);
    assert.deepEqual([result.status, result.members[0].state], ["started", "running"]);
    assert.equal(
      roster().status,
      "hosted",
      "the run record is no longer 'queued', which any monitor scanning rosters would draw",
    );
    assert.deepEqual(roster().members, [{ name: "developer-a-00", actorId: "developer-a-00" }]);
    writeFileSync(rosterPath, JSON.stringify({ runId: c.runId, status: "queued", members: [] }));
    // A launch the host refuses is not tracked.
    const refusing = {
      client: () => ({
        request: async () => {
          throw new Error("Model not found");
        },
      }),
      track: (...a) => tracked.push(a),
    };
    await assert.rejects(
      launchOnHost({
        host: refusing,
        prepared: { configFile: ".pi/runtime/crew-launch/x.json", rosterFile: ".pi/runtime/crew-launch/x-roster.json" },
        cwd,
        configDir: ".pi",
        env: {},
      }),
      /Model not found/,
    );
    assert.equal(tracked.length, 1);
    assert.deepEqual([roster().status, roster().launchError], ["done", "Model not found"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("grants as assembly really produces them reach the host as operations, never silently empty", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-launch-contract-"));
  try {
    const git = ["github_issue_view", "github_workspace_checkout", "github_git_push", "github_pull_request_create"];
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      {
        model: "mock/mock-model",
        members: [
          {
            name: "snowball",
            role: "developer",
            tools: [
              { suite: "system", operations: ["read", "bash", "edit"] },
              { suite: GITHUB, operations: git },
            ],
          },
        ],
      },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    const { spec } = buildLaunchSpec({ config, directory: "/d", env: { HALL_GITHUB_TOKEN: "t" } });
    assert.deepEqual(spec.members[0].suiteGrants, [{ suite: GITHUB, operations: git }]);
    assert.deepEqual(spec.members[0].tools, ["read", "bash", "edit"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
