import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registerArmoryWorkerProxies } from "../../extensions/crew/env-runtime/lib/guest-suite.mjs";
import { githubSuiteExtension } from "../../extensions/crew/runner/github-suite.mjs";

const policy = { repo: "Owner/Repo", revision: "a".repeat(40), base: "main", branch: "worker" };
const operations = [
  "github_issue_view",
  "github_issue_create",
  "github_discussion_view",
  "github_discussion_comments",
  "github_discussions_list",
  "github_discussion_post",
];
const schemas = JSON.parse(readFileSync(new URL("../fixtures/armory-operations.json", import.meta.url))).operations;
const inputFor = (name) => {
  const schema = schemas[name];
  const input = Object.fromEntries(schema.required.map((key) => [key, schema.fields[key] === "integer" ? 1 : "x"]));
  input.repo = name.includes("discussion") ? "Repo" : policy.repo;
  if ("owner" in input) input.owner = "Owner";
  return input;
};

async function exercise(makeInvoker) {
  for (const name of operations) {
    for (const authorized of [true, false]) {
      const { invoke, executed } = await makeInvoker(authorized ? policy : undefined);
      const input = inputFor(name);
      await invoke(name, input);
      assert.equal(executed.length, authorized ? 1 : 0, `${name}: ${authorized ? "allowed" : "absent policy"}`);
      if (authorized) {
        await invoke(name, { ...input, repo: "Other" });
        if ("owner" in input) await invoke(name, { ...input, owner: "Other" });
        assert.equal(executed.length, 1, `${name}: wrong repository or owner must not execute`);
      }
    }
  }
}

test("host hook gates restored operations before their executors", async () => {
  await exercise(async (authorization) => {
    const handlers = new Map();
    const tools = new Map();
    const executed = [];
    const module = {
      activateSuite(pi) {
        for (const name of operations) pi.registerTool({ name, execute: async () => executed.push(name) });
      },
    };
    githubSuiteExtension({
      module,
      workspace: {},
      token: "t",
      policy: authorization,
      transport: { run: async () => "" },
    })({ registerTool: (tool) => tools.set(tool.name, tool), on: (name, handler) => handlers.set(name, handler) });
    return {
      executed,
      async invoke(name, input) {
        const result = await handlers.get("tool_call")({ toolName: name, input });
        if (!result?.block) await tools.get(name).execute("id", input);
      },
    };
  });
});

test("retained guest proxies gate restored operations before guest invocation", async () => {
  await exercise(async (authorization) => {
    const tools = new Map();
    const executed = [];
    let request;
    const guest = {
      fs: {
        async writeFile(_path, value) {
          request = JSON.parse(value);
        },
        async readFile() {
          return JSON.stringify(
            request.operation
              ? { result: {} }
              : { operations: operations.map((name) => ({ name, description: name, parameters: { type: "object" } })) },
          );
        },
      },
      async exec(args) {
        if (args[1] === "invoke") executed.push(request.operation);
        return { exitCode: 0 };
      },
    };
    await registerArmoryWorkerProxies(
      { registerTool: (tool) => tools.set(tool.name, tool) },
      {
        config: {
          suites: [{ rootPath: "/nix/store/0123456789abcdefghijklmnopqrstuv-github", tools: operations }],
          repositoryAuthorization: authorization,
        },
        guest,
      },
    );
    return {
      executed,
      async invoke(name, input) {
        try {
          await tools.get(name).execute("id", input);
        } catch (error) {
          assert.match(error.message, /authorization|outside/i);
        }
      },
    };
  });
});

test("native tools pass the host GitHub hook", async () => {
  const handlers = new Map();
  githubSuiteExtension({ module: { activateSuite() {} }, workspace: {}, token: "t", policy, transport: {} })({
    registerTool() {},
    on: (name, handler) => handlers.set(name, handler),
  });
  for (const toolName of ["read", "edit", "bash"])
    assert.equal(await handlers.get("tool_call")({ toolName, input: {} }), undefined);
});
