import { strict as assert } from "node:assert";
import test from "node:test";
import { verifyPullRequest } from "../../extensions/crew/runner/ci-verify.mjs";
import { hostGhTransport, createSuiteOperations } from "../../extensions/crew/runner/github-suite.mjs";

const a = "a".repeat(40), b = "b".repeat(40);
const evidence = { pullRequest: "https://github.com/o/r/pull/1", pushed: { commit: a } };
const run = (call, extra = {}) => verifyPullRequest({ ops: { call }, policy: { repo: "o/r" }, evidence, pollIntervalMs: 1, ...extra });
const view = (head, rollup) => ({ state: "OPEN", headRefOid: head, statusCheckRollup: rollup });
const success = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "test" }];
const pending = [{ __typename: "CheckRun", status: "QUEUED", name: "test" }];
const files = (head, filename = "src/a") => [{ filename, blob_url: `https://github.com/o/r/blob/${head}/${filename}` }];

test("host transport enriches only PR view rollup queries and suite passes the field through", async () => {
  const seen = [];
  const transport = hostGhTransport({ token: "t", exec: async (_cmd, args) => {
    seen.push(args);
    return { stdout: JSON.stringify(view(a, success)) };
  } });
  const query = ["pr", "view", "1", "-R", "o/r", "--json", "number,title,body,state,isDraft,author,headRefName,baseRefName,labels,reviews,statusCheckRollup,url"];
  const module = { activateSuite(pi, { commandTransport }) { pi.registerTool({ name: "github_pull_request_view", execute: async () => ({ content: [{ text: await commandTransport.run(query) }] }) }); } };
  const result = await createSuiteOperations({ module, workspace: {}, token: "t", transport }).call("github_pull_request_view", {});
  assert.equal(result.headRefOid, a);
  assert.equal(seen[0][6], `${query[6]},headRefOid`);
  assert.ok(!query[6].includes("headRefOid"));
  const ownership = ["pr", "view", "1", "--repo", "o/r", "--json", "headRefName,baseRefName,isCrossRepository"];
  await transport.run(ownership);
  await transport.run(["api", "repos/o/r"]);
  assert.deepEqual(seen[1], ownership);
  assert.deepEqual(seen[2], ["api", "repos/o/r"]);
});

test("uses each snapshot's checks and never borrows an ABA result", async () => {
  const snapshots = [view(a, pending), view(b, pending), view(a, success)];
  let count = 0;
  const result = await run(async (name) => {
    if (name === "github_pull_request_view") return snapshots[count++];
    if (name === "github_pull_request_files") return files(a);
    assert.fail(name);
  });
  assert.equal(count, 3);
  assert.equal(result.headSha, a);
  assert.equal(result.state, "success");
});

test("missing or malformed snapshot head fails closed even with empty files", async () => {
  for (const head of [undefined, "", "abc", "z".repeat(40)]) {
    await assert.rejects(run(async (name) => name === "github_pull_request_view" ? view(head, success) : []), /head/i);
  }
});

test("empty and deleted-only files retain snapshot head; inconsistent gate files fail closed", async () => {
  for (const response of [[], [{ filename: "gone", status: "removed" }]]) {
    const result = await run(async (name) => name === "github_pull_request_view" ? view(a, success) : response);
    assert.equal(result.headSha, a);
  }
  for (const response of [files(b, ".prettierignore"), [{ filename: ".prettierignore", status: "removed" }], [...files(a, ".prettierignore"), ...files(b)]]) {
    await assert.rejects(run(async (name) => name === "github_pull_request_view" ? view(a, success) : response), /head/i);
  }
});

test("head changes restart the no-check grace period", async () => {
  let calls = 0;
  let changedAt;
  const result = await run(async (name) => {
    if (name === "github_pull_request_files") return [];
    calls++;
    if (calls === 2) await new Promise((resolve) => setTimeout(resolve, 15));
    if (calls === 2) changedAt = Date.now();
    return view(calls === 1 ? a : b, []);
  }, { noChecksGraceMs: 10 });
  assert.ok(calls >= 3);
  assert.ok(Date.now() - changedAt >= 10);
  assert.equal(result.headSha, b);
});

test("abort during failed log lookup ignores its late rejection", async () => {
  const controller = new AbortController();
  let rejectLog;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const promise = run(async (name) => {
    if (name === "github_pull_request_view") return view(a, [{ ...success[0], conclusion: "FAILURE", detailsUrl: "https://github.com/o/r/actions/runs/1" }]);
    if (name === "github_workflow_run_failed_log") { started(); return new Promise((_, reject) => { rejectLog = reject; }); }
    assert.fail(name);
  }, { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(promise, /abort/i);
  rejectLog(Error("late"));
  await new Promise((resolve) => setTimeout(resolve, 5));
});
