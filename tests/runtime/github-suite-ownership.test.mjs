import { strict as assert } from "node:assert";
import test from "node:test";
import { githubSuiteExtension } from "../../extensions/crew/runner/github-suite.mjs";

const policy = { repo: "owner/repo", branch: "crew/worker", base: "main" };
const writes = [
  ["github_pull_request_update", { title: "test" }],
  ["github_pull_request_add_label", { labels: ["test"] }],
  ["github_pull_request_remove_label", { label: "test" }],
];

function setup() {
  const handlers = new Map();
  const owned = { headRefName: policy.branch, baseRefName: policy.base, isCrossRepository: false };
  let response = JSON.stringify(owned);
  let lookups = 0;
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: {},
    token: "t",
    policy,
    transport: {
      run: async () => {
        lookups++;
        if (response instanceof Error) throw response;
        return response;
      },
    },
  })({ on: (name, handler) => handlers.set(name, handler) });
  return {
    owned,
    setResponse: (value) => (response = value instanceof Error ? value : JSON.stringify(value)),
    call: (name, extra) =>
      handlers.get("tool_call")({ toolName: name, input: { repo: policy.repo, pullNumber: 1, ...extra } }),
    lookups: () => lookups,
  };
}

test("each own-PR write rechecks current ownership and fails closed", async () => {
  for (const [name, extra] of writes) {
    for (const changed of [
      { headRefName: "other" },
      { baseRefName: "other" },
      { isCrossRepository: true },
      { isCrossRepository: undefined },
      new Error("offline"),
      null,
    ]) {
      const harness = setup();
      assert.equal(await harness.call(name, extra), undefined);
      assert.equal(await harness.call(name, extra), undefined);
      harness.setResponse(changed instanceof Error || changed === null ? changed : { ...harness.owned, ...changed });
      assert.deepEqual(await harness.call(name, extra), {
        block: true,
        reason: "A worker can only change its own pull request",
      });
      assert.equal(harness.lookups(), 3);
    }
  }
});

test("PR reads do not perform ownership verification", async () => {
  const harness = setup();
  assert.equal(await harness.call("github_pull_request_view", {}), undefined);
  assert.equal(harness.lookups(), 0);
});
