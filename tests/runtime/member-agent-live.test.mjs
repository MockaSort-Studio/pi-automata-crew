import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeSeedArchive } from "../../extensions/crew/env-runtime/lib/repository-seed-archive.mjs";
import { createMemberAgent } from "../../extensions/crew/runner/member-agent.mjs";
import { mockModel, providerFor } from "./mock-model.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

const call = (name, args = {}) => ({ toolCall: { name, arguments: JSON.stringify(args) } });
const repository = { repo: "o/r", revision: "a".repeat(40), base: "main" };

// A stand-in for the Armory suite module: records what the runner injects and which operations it is asked for.
const fakeSuite = (calls) => ({
  activateSuite(pi, options) {
    calls.push({ options });
    for (const name of ["github_git_status", "github_git_commit", "github_git_push", "github_issue_view"])
      pi.registerTool({
        name,
        label: name,
        description: name,
        parameters: Type.Object({ repo: Type.Optional(Type.String()) }, { additionalProperties: true }),
        execute: async (_id, input) => {
          calls.push({ name, input });
          return {
            content: [
              { type: "text", text: JSON.stringify(name === "github_git_status" ? { branch: null, files: [] } : {}) },
            ],
            details: {},
          };
        },
      });
  },
});

async function setup(t, respond) {
  const server = mockModel(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "member-agent-"));
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  });
  modelRuntime.registerProvider("mock", providerFor(server));
  const agents = [];
  t.after(async () => {
    for (const agent of agents) await agent.dispose();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const build = async (member, extra = {}, prepareSources = async () => ({ available: [], failures: ["fixture: source unavailable"] })) => {
    const agent = await createMemberAgent({
      prepareSources,
      member: {
        handle: "developer-snowball-00",
        instructions: "You are Snowball, a careful developer.",
        tools: ["read", "bash"],
        suiteGrants: [],
        model: "mock/mock-model",
        ...member,
      },
      crew: { runId: "run1", dir, modelRuntime, settings: { retry: { enabled: false } }, idleMs: 0, ...extra },
    });
    agents.push(agent);
    return agent;
  };
  return { server, dir, build };
}
const offeredTools = (server) =>
  JSON.parse(server.requests[0])
    .tools.map((tool) => tool.function.name)
    .sort();

test("source mount failures do not prevent a member from starting", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const { server, build } = await setup(t, () => ({ text: "ok" }));
  const agent = await build({}, {}, async () => { throw new Error("provider failure"); });
  assert.equal((await agent.run.prompt("hello")).status, "completed");
  assert.match(server.requests[0], /Verified dependency source mount unavailable/);
});

test(
  "a read-only member gets its role's tools and instructions, no GitHub suite and no salvage",
  { timeout: 120_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const { server, build } = await setup(t, () => ({ text: "ok" }));
    const agent = await build({});
    assert.equal((await agent.run.prompt("hello")).status, "completed");
    assert.deepEqual(offeredTools(server), ["bash", "read", "request_input"]);
    assert.match(
      server.requests[0],
      /You are Snowball, a careful developer\./,
      "the role's instructions reach the system prompt",
    );
    assert.match(server.requests[0], /fixture: source unavailable/);
    assert.match(server.requests[0], /hosted CI/);
    assert.equal(agent.salvage, undefined, "no write capability, nothing to salvage");
  },
);

test("the seed is the member's private workspace, visible to its routed tools", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const { server, build, dir } = await setup(t, (n) =>
    n === 1 ? call("bash", { command: "cat /workspace/seeded.txt" }) : { text: "read it" },
  );
  const tree = join(dir, "tree");
  mkdirSync(tree);
  writeFileSync(join(tree, "seeded.txt"), "from the seed\n");
  const agent = await build({}, { seedArchive: writeSeedArchive(tree, "a".repeat(40)) });
  const result = await agent.run.prompt("look");
  assert.equal(result.status, "completed");
  const seen = server.requests.flatMap((body) =>
    JSON.parse(body)
      .messages.filter((m) => m.role === "tool")
      .map((m) => String(m.content)),
  );
  assert.match(seen.join("\n"), /from the seed/);
});

test(
  "a member granted the GitHub suite gets it host-side with its own derived branch, and salvage when it can write",
  { timeout: 120_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const calls = [];
    const { server, build } = await setup(t, (n) =>
      n === 1 ? call("github_issue_view", { repo: "o/r" }) : { text: "done" },
    );
    const grants = [
      {
        suite: "collaboration/pi-github-tools",
        operations: ["github_git_status", "github_git_commit", "github_git_push", "github_issue_view"],
      },
    ];
    const agent = await build(
      { suiteGrants: grants },
      { repository, github: { module: fakeSuite(calls), token: "crew-token" } },
    );
    assert.equal((await agent.run.prompt("go")).status, "completed");
    assert.ok(offeredTools(server).includes("github_git_push"));
    assert.equal(
      agent.policy.branch,
      "crew/run1/developer-snowball-00",
      "the branch is derived by the runner, never chosen by the agent",
    );
    assert.ok(agent.salvage, "write capability earns a host-side rescue");
    assert.equal(calls.find((c) => c.name === "github_issue_view").input.repo, "o/r");
    const injected = calls.find((c) => c.options).options;
    assert.deepEqual(injected.workspace.env, { GITHUB_TOKEN: "crew-token" });
    assert.equal(injected.workspace.dir, "/");
  },
);

test(
  "read-only GitHub grants get no salvage, and a grant without a repository or suite is refused",
  { timeout: 120_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const { build } = await setup(t, () => ({ text: "ok" }));
    const readOnly = [{ suite: "collaboration/pi-github-tools", operations: ["github_issue_view"] }];
    const agent = await build({ suiteGrants: readOnly }, { repository, github: { module: fakeSuite([]), token: "t" } });
    assert.equal(agent.salvage, undefined);
    await assert.rejects(
      build({ handle: "reviewer-x-00", suiteGrants: readOnly }, { repository }),
      /none is available/,
    );
    await assert.rejects(
      build({ handle: "reviewer-y-00", suiteGrants: readOnly }, { github: { module: fakeSuite([]), token: "t" } }),
      /no repository authorization/,
    );
  },
);

test(
  "salvage on a member that wrote nothing is a no-op, and dispose closes the environment",
  { timeout: 120_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const calls = [];
    const { build } = await setup(t, () => ({ text: "ok" }));
    const grants = [
      {
        suite: "collaboration/pi-github-tools",
        operations: ["github_git_status", "github_git_commit", "github_git_push"],
      },
    ];
    const agent = await build(
      { suiteGrants: grants },
      { repository, github: { module: fakeSuite(calls), token: "t" } },
    );
    assert.deepEqual(await agent.salvage("completed"), { branch: "crew/run1/developer-snowball-00", skipped: true });
    await agent.environment.withVm((vm) => vm.exec("true"));
    assert.equal(agent.environment.isRunning(), true);
    await agent.dispose();
    assert.equal(agent.environment.isRunning(), false);
    await assert.rejects(
      agent.environment.withVm(() => {}),
      /closed/,
    );
  },
);
