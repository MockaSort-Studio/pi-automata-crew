import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skipWithoutGit } from "./requires-git.mjs";
import git from "isomorphic-git";
import { Type } from "typebox";
import { repositoryContext } from "../../extensions/crew/env-runtime/lib/repository-context.mjs";
import { populateRepositoryWorkspace } from "../../extensions/crew/env-runtime/lib/repository-workspace.mjs";
import { buildShallowCheckout } from "../../extensions/crew/env-runtime/lib/repository-seed-archive.mjs";
import { MemoryProvider } from "@earendil-works/gondolin";
import { githubSuiteExtension, hostGhTransport } from "../../extensions/crew/runner/github-suite.mjs";
import { workspaceFs } from "../../extensions/crew/runner/workspace-fs.mjs";

const context = repositoryContext({
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
    assert.deepEqual(seen[0].args, ["api", "user"], "arguments reach gh exactly as given");
    await transport.run(["pr", "view", "1", "--json", "statusCheckRollup"]);
    assert.deepEqual(seen[1].args, ["pr", "view", "1", "--json", "statusCheckRollup"]);
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
    buildShallowCheckout({ cwd: process.cwd(), repo: context.repo, revision }),
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

const fakeModule = (executed, names = ["github_git_push", "github_issue_view", "github_pull_request_merge"]) => ({
  activateSuite(pi, options) {
    executed.options = options;
    for (const name of names)
      pi.registerTool({
        name,
        label: name,
        description: name,
        parameters: Type.Object({ repo: Type.String() }),
        execute: async (_id, input) => (executed.push({ name, input }), { content: [], details: {} }),
      });
  },
});
const install = (options) => {
  const tools = new Map();
  const handlers = new Map();
  githubSuiteExtension({
    workspace: new MemoryProvider(),
    token: "crew-token",
    transport: { run: async () => "" },
    ...options,
  })({
    registerTool: (tool) => tools.set(tool.name, tool),
    on: (name, handler) => handlers.set(name, handler),
  });
  return { tools, handlers };
};

test("only the operations a member was granted are registered, with the injected workspace, transport and token", () => {
  const executed = [];
  const { tools } = install({ module: fakeModule(executed), operations: ["github_issue_view", "github_git_push"] });
  assert.deepEqual([...tools.keys()].sort(), ["github_git_push", "github_issue_view"]);
  assert.equal(tools.has("github_pull_request_merge"), false, "an operation that was not granted does not exist");
  assert.equal(executed.options.workspace.env.GITHUB_TOKEN, "crew-token");
  assert.ok(executed.options.commandTransport);
});

test("a granted operation the suite does not provide fails when the suite is loaded", () => {
  assert.throws(
    () => install({ module: fakeModule([]), operations: ["github_issue_view", "github_not_real"] }),
    /no operation: github_not_real/,
  );
});

test("a granted call is not inspected: the member's tool list is the authority", async () => {
  const executed = [];
  const { tools, handlers } = install({ module: fakeModule(executed), operations: ["github_git_push"] });
  const input = { repo: "any/repository" };
  assert.equal(await handlers.get("tool_call")({ toolName: "github_git_push", input }), undefined);
  await tools.get("github_git_push").execute("id", input);
  assert.deepEqual([...executed], [{ name: "github_git_push", input }]);
});

test("a host-side tool call waits for the workspace to be seeded, and fails closed if seeding fails", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let seeded = false;
  const waiting = install({
    module: fakeModule([]),
    operations: ["github_issue_view"],
    ready: () => gate.then(() => (seeded = true)),
  });
  const pending = waiting.handlers.get("tool_call")({ toolName: "github_issue_view", input: {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(seeded, false, "the call is held while the workspace is being prepared");
  release();
  assert.equal(await pending, undefined);
  assert.equal(seeded, true);

  const failing = install({
    module: fakeModule([]),
    operations: ["github_issue_view"],
    ready: async () => {
      throw new Error("seed failed");
    },
  });
  const blocked = await failing.handlers.get("tool_call")({ toolName: "github_issue_view", input: {} });
  assert.match(blocked.reason, /could not be prepared: seed failed/);
});
