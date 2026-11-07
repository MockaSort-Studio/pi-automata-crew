import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import git from "isomorphic-git";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { repositoryAuthorization } from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";
import { populateRepositoryWorkspace } from "../../extensions/crew/env-runtime/lib/repository-workspace.mjs";
import { buildShallowCheckout } from "../../extensions/crew/env-runtime/lib/repository-seed-archive.mjs";
import { WorkspaceProvider } from "../../extensions/crew/env-runtime/lib/workspace-provider.mjs";
import { runAgent } from "../../extensions/crew/runner/agent-run.mjs";
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
  const root = mkdtempSync(join(tmpdir(), "suite-fs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const workspace = new WorkspaceProvider();
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
  const workspace = new WorkspaceProvider();
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
      ["github_issue_view", "anyone/anything"],
    ],
    "the push to main was blocked before it ran; the authorized push and an unguarded tool executed",
  );
  assert.equal(result.usage.toolErrors, 1, "the blocked call surfaced to the agent as an error");
});

test("a host-side tool call waits for the workspace to be seeded, and fails closed if seeding fails", async () => {
  const handlers = [];
  const pi = { registerTool() {}, on: (name, handler) => handlers.push([name, handler]) };
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let seeded = false;
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: new WorkspaceProvider(),
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
    workspace: new WorkspaceProvider(),
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
