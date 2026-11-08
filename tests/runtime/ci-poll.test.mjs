import { strict as assert } from "node:assert";
import test from "node:test";
import { summarizeChecks, verifyPullRequest } from "../../extensions/crew/runner/ci-verify.mjs";

const policy = { repo: "o/r" };
const evidence = { pullRequest: "https://github.com/o/r/pull/9", pushed: { commit: "a".repeat(40) } };
const run = (call, options = {}) =>
  verifyPullRequest({ ops: { call }, policy, evidence, pollIntervalMs: 1, ...options });
const file = (sha) => [{ filename: "src/a", blob_url: `https://github.com/o/r/blob/${sha}/src/a` }];
const check = (status, conclusion) => ({
  __typename: "CheckRun",
  name: "test",
  workflowName: "CI",
  status,
  conclusion,
});

test("summarizes checks with failures taking precedence over pending", () => {
  assert.equal(summarizeChecks([]).state, "none");
  assert.equal(summarizeChecks([check("QUEUED")]).state, "pending");
  assert.equal(summarizeChecks([check("COMPLETED", "NEUTRAL")]).state, "success");
  assert.equal(summarizeChecks([{ __typename: "StatusContext", context: "build", state: "SUCCESS" }]).state, "success");
  assert.equal(summarizeChecks([check("QUEUED"), check("COMPLETED", "FAILURE")]).state, "failure");
});

test("polls again and reports a head pushed by someone else", async () => {
  let polls = 0;
  const result = await run(async (name) => {
    if (name === "github_pull_request_view")
      return {
        state: "OPEN",
        headRefOid: (polls++ === 0 ? "a" : "b").repeat(40),
        statusCheckRollup: [polls === 1 ? check("QUEUED") : check("COMPLETED", "SUCCESS")],
      };
    if (name === "github_pull_request_files") return file("b".repeat(40));
    assert.fail(name);
  });
  assert.equal(polls, 2);
  assert.equal(result.headSha, "b".repeat(40));
  assert.equal(result.headDiffersFromPush, true);
});

test("uses the head from the same snapshot as the failure", async () => {
  const result = await run(async (name) => {
    if (name === "github_pull_request_view")
      return {
        state: "OPEN",
        headRefOid: "b".repeat(40),
        statusCheckRollup: [check("COMPLETED", "FAILURE")],
      };
    assert.fail(name);
  });
  assert.equal(result.state, "failure");
  assert.equal(result.headSha, "b".repeat(40));
});

test("abort interrupts both sleep and a hung poll", async () => {
  for (const hung of [false, true]) {
    const controller = new AbortController();
    const promise = run(
      async (name) => {
        if (hung) return new Promise(() => {});
        if (name === "github_pull_request_view")
          return {
            state: "OPEN",
            headRefOid: "a".repeat(40),
            statusCheckRollup: [check("QUEUED")],
          };
        assert.fail(name);
      },
      { signal: controller.signal, pollIntervalMs: 10000 },
    );
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(
      Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error("timeout")), 200))]),
      /abort/i,
    );
  }
});

test("no checks grace polls before settling; closed PR exits", async () => {
  let polls = 0;
  const result = await run(
    async (name) => {
      if (name === "github_pull_request_view") {
        polls++;
        return { state: "OPEN", headRefOid: "a".repeat(40), statusCheckRollup: [] };
      }
      return file("a".repeat(40));
    },
    { noChecksGraceMs: 5 },
  );
  assert.equal(result.state, "none");
  assert.ok(polls > 1);
  assert.equal((await run(async () => ({ state: "MERGED" }))).state, "closed");
});

test("failure obtains workflow log tail", async () => {
  const calls = [];
  const result = await run(async (name, input) => {
    calls.push([name, input]);
    if (name === "github_pull_request_view")
      return {
        state: "OPEN",
        headRefOid: "b".repeat(40),
        statusCheckRollup: [
          { ...check("COMPLETED", "FAILURE"), detailsUrl: "https://github.com/o/r/actions/runs/42/job/1" },
        ],
      };
    if (name === "github_pull_request_files") return file("b".repeat(40));
    if (name === "github_workflow_run_failed_log") return "tail marker";
    assert.fail(name);
  });
  assert.match(result.followUp, /tail marker/);
  assert.deepEqual(calls.find(([name]) => name === "github_workflow_run_failed_log")[1], {
    repo: "o/r",
    runId: 42,
    maxChars: 2500,
  });
});
