import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skipWithoutGit } from "./requires-git.mjs";
import git from "isomorphic-git";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { repositoryAuthorization } from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";
import { populateRepositoryWorkspace } from "../../extensions/crew/env-runtime/lib/repository-workspace.mjs";
import { buildShallowCheckout } from "../../extensions/crew/env-runtime/lib/repository-seed-archive.mjs";
import { MemoryProvider } from "@earendil-works/gondolin";
import { runAgent } from "./run-agent.mjs";
import { githubSuiteExtension, hostGhTransport } from "../../extensions/crew/runner/github-suite.mjs";
import { workspaceFs } from "../../extensions/crew/runner/workspace-fs.mjs";
import { mockModel, providerFor } from "./mock-model.mjs";

const policy = repositoryAuthorization({
  repo: "MockaSort-Studio/pi-automata-crew",
  revision: "a".repeat(40),
  base: "main",
  branch: "crew/run/dev",
});

test("the host gh transport uses only the Crew token and an empty private config", async () => {
  process.env.GH_TOKEN = "user-login-token";
  process.env.HALL_GITHUB_TOKEN = "host-secret";
  try {
    const seen = [];
    const transport = hostGhTransport({
      token: "crew-token",
      exec: async (command, args, options) => (seen.push({ command, args, options }), { stdout: "ok" }),
    });
    assert.equal(await transport.run(["api", "user"]), "ok");
    const { env } = seen[0].options;
    assert.equal(env.GH_TOKEN, "crew-token");
    assert.notEqual(env.GH_CONFIG_DIR, undefined);
    assert.equal(env.HOME, env.GH_CONFIG_DIR, "gh never reads the user's own configuration");
    assert.equal(env.HALL_GITHUB_TOKEN, undefined, "no other credential leaks into gh");
    assert.deepEqual(seen[0].args, ["api", "user"]);
    assert.throws(() => hostGhTransport({ token: "" }), /requires a Crew token/);
  } finally {
    delete process.env.GH_TOKEN;
    delete process.env.HALL_GITHUB_TOKEN;
  }
});

test("isomorphic-git works on the host-held workspace through the fs adapter, matching real Git", async (t) => {
  if (skipWithoutGit(t)) return;
  const root = mkdtempSync(join(tmpdir(), "suite-fs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const workspace = new MemoryProvider();
  await populateRepositoryWorkspace(
    workspace,
    buildShallowCheckout({ cwd: process.cwd(), repo: policy.repo, revision }),
  );
  const fs = workspaceFs(workspace);
  const dirty = async () =>
    (await git.statusMatrix({ fs, dir: "/" })).filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1));
  assert.equal(await git.resolveRef({ fs, dir: "/", ref: "HEAD" }), revision);
  assert.deepEqual(await dirty(), [], "a fresh seed has no changes");
  await workspace.writeFile("/NEW.md", "hello\n");
  await workspace.writeFile("/README.md", "changed\n");
  assert.deepEqual(
    (await dirty()).map(([path, h, w]) => [path, h, w]),
    [
      ["NEW.md", 0, 2],
      ["README.md", 1, 2],
    ],
  );
  await git.add({ fs, dir: "/", filepath: "NEW.md" });
  await git.add({ fs, dir: "/", filepath: "README.md" });
  const oid = await git.commit({ fs, dir: "/", message: "probe", author: { name: "t", email: "t@t" } });
  assert.equal((await git.readCommit({ fs, dir: "/", oid })).commit.parent[0], revision);
  assert.deepEqual(
    (await git.listFiles({ fs, dir: "/", ref: oid })).filter((p) => p === "NEW.md"),
    ["NEW.md"],
  );
});

const fakeModule = (calls) => ({
  activateSuite(pi, options) {
    calls.push(options);
    for (const name of ["github_git_push", "github_issue_view"])
      pi.registerTool({
        name,
        label: name,
        description: name,
        parameters: Type.Object({ repo: Type.String(), branch: Type.Optional(Type.String()) }),
        execute: async (_id, input) => (
          calls.executed.push({ name, input }), { content: [{ type: "text", text: "{}" }], details: {} }
        ),
      });
  },
});

test("the suite is installed with the injected workspace, transport and credential, and the policy guard blocks before execution", async (t) => {
  const server = mockModel((n) =>
    n === 1
      ? { toolCall: { name: "github_git_push", arguments: JSON.stringify({ repo: policy.repo, branch: "main" }) } }
      : n === 2
        ? {
            toolCall: {
              name: "github_git_push",
              arguments: JSON.stringify({ repo: policy.repo, branch: policy.branch }),
            },
          }
        : n === 3
          ? { toolCall: { name: "github_issue_view", arguments: JSON.stringify({ repo: policy.repo }) } }
          : n === 4
            ? { toolCall: { name: "github_issue_view", arguments: JSON.stringify({ repo: "anyone/anything" }) } }
            : { text: "done" },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "suite-run-"));
  mkdirSync(join(dir, "cwd"));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const calls = Object.assign([], { executed: [] });
  const workspace = new MemoryProvider();
  const transport = { run: async () => "" };
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  });
  modelRuntime.registerProvider("mock", providerFor(server));
  const result = await runAgent({
    cwd: join(dir, "cwd"),
    model: "mock/mock-model",
    task: "push",
    tools: ["github_git_push", "github_issue_view"],
    extensionFactories: [
      githubSuiteExtension({ module: fakeModule(calls), workspace, token: "crew-token", policy, transport }),
    ],
    settings: { retry: { enabled: false } },
    modelRuntime,
  });
  assert.equal(result.status, "completed");
  const [options] = calls;
  assert.equal(options.commandTransport, transport);
  assert.equal(options.workspace.dir, "/");
  assert.deepEqual(options.workspace.env, { GITHUB_TOKEN: "crew-token" });
  await options.workspace.fs.promises.writeFile("/probe", "x");
  assert.equal((await workspace.readFile("/probe")).toString(), "x", "the injected fs is the environment's workspace");
  assert.deepEqual(
    calls.executed.map(({ name, input }) => [name, input.branch ?? input.repo]),
    [
      ["github_git_push", policy.branch],
      ["github_issue_view", policy.repo],
    ],
    "the push to main and cross-repo issue view were blocked; authorized calls executed",
  );
  assert.equal(result.usage.toolErrors, 2, "both blocked calls surfaced to the agent as errors");
});

test("native tools pass the GitHub hook while unknown GitHub operations are blocked", async () => {
  const handlers = new Map();
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: new MemoryProvider(),
    token: "t",
    policy,
    transport: { run: async () => "" },
  })({ registerTool() {}, on: (name, handler) => handlers.set(name, handler) });
  const guard = handlers.get("tool_call");
  let executed = false;
  const result = await guard({ toolName: "read", input: { path: "file" } });
  if (!result?.block) executed = true;
  assert.equal(executed, true);
  assert.match((await guard({ toolName: "github_unknown", input: {} })).reason, /Unclassified/);
});

test("pull requests are forced to drafts without changing other calls or bypassing authorization", async () => {
  const handlers = new Map();
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: new MemoryProvider(),
    token: "t",
    policy,
    transport: { run: async () => "" },
  })({ registerTool() {}, on: (name, handler) => handlers.set(name, handler) });
  const call = handlers.get("tool_call");
  const result = handlers.get("tool_result");
  const base = { repo: policy.repo, head: policy.branch, base: policy.base, title: "test" };
  for (const extra of [{}, { draft: false }, { draft: true }]) {
    const event = { toolName: "github_pull_request_create", input: { ...base, ...extra } };
    assert.equal(await call(event), undefined);
    assert.equal(event.input.draft, true, "the tool receives a draft request");
  }
  const other = { toolName: "github_issue_view", input: { repo: policy.repo } };
  assert.equal(await call(other), undefined);
  assert.deepEqual(other.input, { repo: policy.repo });
  const refused = { toolName: "github_pull_request_create", input: { ...base, base: "wrong" } };
  assert.match((await call(refused)).reason, /outside the worker authorization/);
  assert.equal(refused.input.draft, undefined);
  const content = [{ type: "text", text: '{"number":1}' }];
  assert.match(
    result({ toolName: "github_pull_request_create", content, isError: false }).content.at(-1).text,
    /draft/i,
  );
  assert.equal(result({ toolName: "github_pull_request_create", content, isError: true }), undefined);
  assert.equal(result({ toolName: "github_issue_view", content, isError: false }), undefined);
});

test("the hook passes released optional workflow inputs and blocks malformed ones", async () => {
  const handlers = new Map();
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: new MemoryProvider(),
    token: "t",
    policy,
    transport: { run: async () => "" },
  })({ registerTool() {}, on: (name, handler) => handlers.set(name, handler) });
  const guard = handlers.get("tool_call");
  const repo = policy.repo;
  for (const event of [
    { toolName: "github_workflow_run_view", input: { repo, runId: 1, artifacts: true } },
    {
      toolName: "github_workflow_run_failed_log",
      input: { repo, runId: 1, jobId: 2, step: 3, firstFailure: true, startLine: 4, maxLines: 50, startChar: 0 },
    },
    {
      toolName: "github_workflow_run_failed_log",
      input: { repo, runId: 1, artifactId: 5, artifactName: "logs", artifactPath: "out/report.txt", maxChars: 100 },
    },
  ])
    assert.equal(await guard(event), undefined, JSON.stringify(event.input));
  for (const [input, reason] of [
    [{ repo, runId: 1, artifactPath: "../secret" }, /Invalid artifactPath/],
    [{ repo, runId: 1, maxLines: 2001 }, /Invalid maxLines/],
    [{ repo, runId: 1, jobId: -1 }, /Invalid jobId/],
    [{ repo, runId: 1, logUrl: "https://x" }, /does not accept/],
    [{ repo: "other/repo", runId: 1, jobId: 1 }, /outside the worker authorization/],
  ])
    assert.match((await guard({ toolName: "github_workflow_run_failed_log", input })).reason, reason);
});

test("PR ownership applies only to writes and fails closed", async () => {
  const handlers = new Map();
  const calls = [];
  const transport = {
    run: async (args) => {
      calls.push(args);
      const number = Number(args[2]);
      if (number === 5) throw new Error("offline");
      return JSON.stringify({
        headRefName: number === 2 ? "other" : policy.branch,
        baseRefName: number === 3 ? "other" : policy.base,
        isCrossRepository: number === 4,
      });
    },
  };
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: new MemoryProvider(),
    token: "t",
    policy,
    transport,
  })({ registerTool() {}, on: (name, handler) => handlers.set(name, handler) });
  const guard = handlers.get("tool_call");
  const call = (toolName, input) => guard({ toolName, input, toolCallId: `test-${toolName}` });
  for (const name of [
    "github_pull_requests_list",
    "github_pull_request_view",
    "github_pull_request_files",
    "github_pull_request_checks",
    "github_pull_request_review_threads",
  ]) {
    assert.equal(
      await call(name, name.endsWith("list") ? { repo: policy.repo } : { repo: policy.repo, pullNumber: 2 }),
      undefined,
    );
  }
  for (const name of [
    "github_pull_request_update",
    "github_pull_request_add_label",
    "github_pull_request_remove_label",
  ]) {
    const input = (pullNumber) => ({
      repo: policy.repo,
      pullNumber,
      ...(name.endsWith("update") ? { title: "x" } : {}),
    });
    assert.equal(await call(name, input(1)), undefined);
    for (const number of [2, 3, 4, 5])
      assert.match((await call(name, input(number))).reason, /can only change its own pull request/);
  }
  assert.equal(calls.filter((args) => args[2] === "1").length, 3);
  assert.deepEqual(calls[0], [
    "pr",
    "view",
    "1",
    "--repo",
    policy.repo,
    "--json",
    "headRefName,baseRefName,isCrossRepository",
  ]);
  const count = calls.length;
  for (const name of [
    "github_pull_request_comment",
    "github_pull_request_review",
    "github_pull_request_review_start",
    "github_pull_request_merge",
  ])
    assert.equal(await call(name, { repo: policy.repo, pullNumber: 2 }), undefined);
  assert.equal(calls.length, count);
});

test("a host-side tool call waits for the workspace to be seeded, and fails closed if seeding fails", async () => {
  const handlers = [];
  const pi = { registerTool() {}, on: (name, handler) => handlers.push([name, handler]) };
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let seeded = false;
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: new MemoryProvider(),
    token: "t",
    policy,
    transport: { run: async () => "" },
    ready: () => gate.then(() => (seeded = true)),
  })(pi);
  const guard = handlers.find(([name]) => name === "tool_call")[1];
  const pending = guard({ toolName: "github_git_status", input: { repo: policy.repo } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seeded, false, "the call is held while the workspace is being prepared");
  release();
  assert.equal(await pending, undefined);
  assert.equal(seeded, true);

  const failing = [];
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: new MemoryProvider(),
    token: "t",
    policy,
    transport: { run: async () => "" },
    ready: async () => {
      throw new Error("seed failed");
    },
  })({ registerTool() {}, on: (name, handler) => failing.push([name, handler]) });
  const blocked = await failing.find(([name]) => name === "tool_call")[1]({
    toolName: "github_git_status",
    input: { repo: policy.repo },
  });
  assert.match(blocked.reason, /could not be prepared: seed failed/);
});
