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

test("it waits for exactly the commit the member pushed, on its own pull request, and can be cancelled", async () => {
  const calls = [];
  const controller = new AbortController();
  const ops = {
    call: async (name, input, options) => (calls.push([name, input, options]), { state: "success", checks: [] }),
  };
  const evidence = { pullRequest: "https://github.com/o/r/pull/9", pushed: { commit: "f".repeat(40) } };
  const result = await verifyPullRequest({ ops, policy, evidence, signal: controller.signal });
  assert.deepEqual(calls[0], [
    "github_pull_request_checks_wait",
    { repo: "o/r", pullNumber: 9, sha: "f".repeat(40) },
    { signal: controller.signal },
  ]);
  assert.equal(calls[1][0], "github_pull_request_files", "then it looks at what the pull request changed");
  assert.deepEqual([result.state, result.pullNumber, result.followUp], ["success", 9, undefined]);
});

test("a red result carries a bounded follow-up naming each failing check with its log tail", async () => {
  const huge = `${"noise\n".repeat(5000)}AssertionError: expected 1 to equal 2`;
  const ops = {
    call: async () => ({
      state: "failure",
      checks: [],
      failures: [
        { name: "CI / test", url: "https://github.com/o/r/actions/runs/1", logTail: huge },
        { name: "CI / format", url: "https://github.com/o/r/actions/runs/1", logTail: "" },
      ],
    }),
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
    ],
  );
  assert.deepEqual(
    names([".gitignore", "docs/a.md", "src/index.js", "package.json", "tests/a.test.mjs", "github/workflows.md"]),
    [],
  );
});

test("a green result reports whether the pull request changed the files that define the checks", async () => {
  const ops = {
    call: async (name) =>
      name === "github_pull_request_checks_wait"
        ? { state: "success", checks: [] }
        : [{ filename: "docs/ci-probe.md" }, { filename: ".prettierignore" }],
  };
  const evidence = { pullRequest: "https://github.com/o/r/pull/9" };
  const check = await verifyPullRequest({ ops, policy, evidence });
  assert.deepEqual(check.gateFiles, [".prettierignore"]);
  // A red result goes back to the member first: it does not look at the files at all.
  const red = {
    call: async (name) =>
      name === "github_pull_request_files"
        ? assert.fail("not needed for a red CI")
        : { state: "failure", failures: [] },
  };
  assert.equal((await verifyPullRequest({ ops: red, policy, evidence })).state, "failure");
});

test("the follow-up tells the member not to weaken the checks", () => {
  assert.match(ciFollowUp({ pullNumber: 1 }), /do not disable, skip, ignore or exclude checks/);
});
