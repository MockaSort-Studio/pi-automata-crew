import { strict as assert } from "node:assert";
import test from "node:test";
import { ciFollowUp, gateFilesOf, pullNumberOf, verifyPullRequest } from "../../extensions/crew/runner/ci-verify.mjs";

const policy = { repo: "o/r", revision: "a".repeat(40), base: "main", branch: "crew/run/dev" };

test("the pull request number comes from the URL the member's evidence recorded", () => {
  assert.equal(pullNumberOf("https://github.com/o/r/pull/42"), 42);
  assert.equal(pullNumberOf("https://github.com/o/r/pull/42/files"), 42);
  for (const bad of [undefined, "", "https://github.com/o/r/issues/42", "https://github.com/o/r/pull/x"])
    assert.equal(pullNumberOf(bad), undefined, String(bad));
});

test("no pull request in the evidence means there is nothing to gate", async () => {
  const ops = { call: async () => assert.fail("must not call GitHub without a pull request") };
  assert.equal(await verifyPullRequest({ ops, policy, evidence: { commits: [] } }), null);
});

test("it checks the current pull request with the supplied signal", async () => {
  const calls = [];
  const controller = new AbortController();
  const ops = {
    call: async (name, input, options) => {
      calls.push([name, input, options]);
      if (name === "github_pull_request_view")
        return {
          state: "OPEN",
          headRefOid: "f".repeat(40),
          statusCheckRollup: [{ __typename: "StatusContext", state: "SUCCESS" }],
        };
      return [{ filename: "src/a", blob_url: `https://github.com/o/r/blob/${"f".repeat(40)}/src/a` }];
    },
  };
  const evidence = { pullRequest: "https://github.com/o/r/pull/9", pushed: { commit: "f".repeat(40) } };
  const result = await verifyPullRequest({ ops, policy, evidence, signal: controller.signal });
  assert.deepEqual(calls[0], [
    "github_pull_request_view",
    { repo: "o/r", pullNumber: 9 },
    { signal: controller.signal },
  ]);
  assert.deepEqual([result.state, result.pullNumber, result.followUp], ["success", 9, undefined]);
});

test("a red result carries a bounded follow-up naming each failing check with its log tail", async () => {
  const huge = `${"noise\n".repeat(5000)}AssertionError: expected 1 to equal 2`;
  const ops = {
    call: async (name) => {
      if (name === "github_workflow_run_failed_log") return huge;
      if (name !== "github_pull_request_view") assert.fail(name);
      return {
        state: "OPEN",
        headRefOid: "abcdef0123456789".padEnd(40, "0"),
        statusCheckRollup: [
          {
            __typename: "CheckRun",
            workflowName: "CI",
            name: "test",
            status: "COMPLETED",
            conclusion: "FAILURE",
            detailsUrl: "https://github.com/o/r/actions/runs/1",
          },
          { __typename: "CheckRun", workflowName: "CI", name: "format", status: "COMPLETED", conclusion: "FAILURE" },
        ],
      };
    },
  };
  const evidence = { pullRequest: "https://github.com/o/r/pull/9", pushed: { commit: "abcdef0123456789" } };
  const { followUp } = await verifyPullRequest({ ops, policy, evidence });
  assert.match(followUp, /CI is red on your pull request #9 \(commit abcdef0\)/);
  assert.match(followUp, /### CI \/ test/);
  assert.match(followUp, /AssertionError: expected 1 to equal 2/, "the end of the log is what matters and is kept");
  assert.match(followUp, /### CI \/ format[^]*\(no log available\)/);
  assert.match(followUp, /request_input/, "it says what to do when the member cannot fix it");
  assert.ok(followUp.length <= 8000, `follow-up was ${followUp.length} characters`);
  assert.equal(ciFollowUp({ pullNumber: 1 }).includes("###"), false);
});

test("files that define the checks are recognized; ordinary files are not", () => {
  const names = (list) => gateFilesOf(list.map((filename) => ({ filename })));
  assert.deepEqual(
    names([
      ".prettierignore",
      ".github/workflows/ci.yml",
      ".github/actions/x/action.yml",
      "pkg/.eslintrc.json",
      ".prettierrc.json",
      "eslint.config.js",
      "vitest.config.ts",
      "jest.config.mjs",
      "package.json",
      "tools/package.json",
    ]),
    [
      ".prettierignore",
      ".github/workflows/ci.yml",
      ".github/actions/x/action.yml",
      "pkg/.eslintrc.json",
      ".prettierrc.json",
      "eslint.config.js",
      "vitest.config.ts",
      "jest.config.mjs",
      "package.json",
      "tools/package.json",
    ],
  );
  assert.deepEqual(
    names([
      ".gitignore",
      "docs/a.md",
      "src/index.js",
      "package-json.md",
      "docs/package.json.md",
      "tests/a.test.mjs",
      "github/workflows.md",
    ]),
    [],
  );
});

test("a green result reports whether the pull request changed the files that define the checks", async () => {
  const ops = {
    call: async (name) =>
      name === "github_pull_request_view"
        ? {
            state: "OPEN",
            headRefOid: "f".repeat(40),
            statusCheckRollup: [{ __typename: "StatusContext", state: "SUCCESS" }],
          }
        : [
            {
              filename: "docs/ci-probe.md",
              blob_url: `https://github.com/o/r/blob/${"f".repeat(40)}/docs/ci-probe.md`,
            },
            {
              filename: ".prettierignore",
              blob_url: `https://github.com/o/r/blob/${"f".repeat(40)}/.prettierignore`,
            },
          ],
  };
  const evidence = { pullRequest: "https://github.com/o/r/pull/9", pushed: { commit: "f".repeat(40) } };
  const check = await verifyPullRequest({ ops, policy, evidence });
  assert.deepEqual(check.gateFiles, [".prettierignore"]);
  // A red result goes back to the member before gate acknowledgement.
  const red = {
    call: async (name) =>
      name === "github_pull_request_view"
        ? {
            state: "OPEN",
            headRefOid: "f".repeat(40),
            statusCheckRollup: [{ __typename: "StatusContext", state: "FAILURE" }],
          }
        : assert.fail(name),
  };
  assert.equal((await verifyPullRequest({ ops: red, policy, evidence })).state, "failure");
});

test("closed pull requests are reported even with gate files and missing or stale evidence", async () => {
  for (const commit of [undefined, "b".repeat(40)]) {
    const ops = {
      call: async (name) =>
        name === "github_pull_request_view" ? { state: "MERGED" } : assert.fail("closed PR must not be polled"),
    };
    const evidence = { pullRequest: "https://github.com/o/r/pull/9", pushed: { commit } };
    const check = await verifyPullRequest({ ops, policy, evidence });
    assert.equal(check.state, "closed");
    assert.equal(check.prState, "MERGED");
  }
});

test("the follow-up tells the member not to weaken the checks", () => {
  assert.match(ciFollowUp({ pullNumber: 1 }), /do not disable, skip, ignore or exclude checks/);
});
