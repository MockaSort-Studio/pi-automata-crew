import { strict as assert } from "node:assert";
import test from "node:test";
import { githubSuiteExtension } from "../../extensions/crew/runner/github-suite.mjs";

const policy = { repo: "owner/repo", branch: "crew/worker", base: "main" };
const writes = [
  "github_pull_request_update",
  "github_pull_request_add_label",
  "github_pull_request_remove_label",
];
const owned = () => ({ headRefName: policy.branch, baseRefName: policy.base, isCrossRepository: false });

function setup() {
  const handlers = new Map();
  const calls = [];
  let response = owned();
  const transport = {
    async run(args) {
      calls.push(args);
      if (response instanceof Error) throw response;
      return JSON.stringify(response);
    },
  };
  githubSuiteExtension({ module: { activateSuite() {} }, workspace: {}, token: "t", policy, transport })({
    on: (name, handler) => handlers.set(name, handler),
  });
  return {
    calls,
    setResponse: (value) => (response = value),
    call: (toolName) =>
      handlers.get("tool_call")({
        toolName,
        input: { repo: policy.repo, pullNumber: 1, ...(toolName.endsWith("update") ? { title: "x" } : {}) },
      }),
  };
}

test("each own-PR write rechecks current ownership and fails closed", async () => {
  for (const name of writes) {
    for (const changed of [
      { ...owned(), headRefName: "another-branch" },
      { ...owned(), baseRefName: "another-base" },
      { ...owned(), isCrossRepository: true },
      { ...owned(), isCrossRepository: undefined },
      new Error("offline"),
      null,
    ]) {
      const suite = setup();
      assert.equal(await suite.call(name), undefined);
      assert.equal(await suite.call(name), undefined, "unchanged ownership remains authorized");
      suite.setResponse(changed);
      assert.deepEqual(await suite.call(name), {
        block: true,
        reason: "A worker can only change its own pull request",
      });
      assert.equal(suite.calls.length, 3);
      assert.deepEqual(suite.calls[0], [
        "pr",
        "view",
        "1",
        "--repo",
        policy.repo,
        "--json",
        "headRefName,baseRefName,isCrossRepository",
      ]);
    }
  }
});

test("PR reads do not verify ownership", async () => {
  const suite = setup();
  assert.equal(await suite.call("github_pull_request_view"), undefined);
  assert.equal(suite.calls.length, 0);
});
