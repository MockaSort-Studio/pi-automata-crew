import { strict as assert } from "node:assert";
import test from "node:test";
import { githubSuiteExtension } from "../../extensions/crew/runner/github-suite.mjs";

const policy = { repo: "owner/repo", branch: "crew/worker", base: "main" };
const start = "github_pull_request_review_start";
const inline = "github_pull_request_review_inline_comment";
const submit = "github_pull_request_review_submit";
const target = { repo: policy.repo, pullNumber: 7 };
const inlineInput = (reviewId, extra = {}) => ({ ...target, reviewId, path: "a", line: 1, body: "fix", ...extra });
const submitInput = (reviewId) => ({ reviewId, event: "COMMENT", hasBlockingFindings: false });

function setup(currentPolicy = policy, ready) {
  const handlers = new Map();
  let lookups = 0;
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: {},
    token: "t",
    policy: currentPolicy,
    ready,
    transport: { run: async () => (lookups++, "") },
  })({ on: (name, handler) => handlers.set(name, handler) });
  return {
    call: (toolName, input, toolCallId = "call") => handlers.get("tool_call")({ toolName, input, toolCallId }),
    result: (toolCallId, input, extra, toolName = start) =>
      handlers.get("tool_result")({ toolName, input, toolCallId, ...extra }),
    lookups: () => lookups,
  };
}

const details = (input, reviewId) => ({ details: { ...input, reviewId }, isError: false });

test("review mutations require provenance from this instance's authorized start", async () => {
  const h = setup();
  assert.equal(await h.call(start, target, "a"), undefined);
  h.result("a", target, details(target, "own"));
  for (let i = 0; i < 3; i++) assert.equal(await h.call(inline, inlineInput("own")), undefined);
  assert.equal(await h.call(submit, submitInput("own")), undefined);
  h.result("submit", submitInput("own"), { isError: false }, submit);
  assert.ok((await h.call(inline, inlineInput("own"))).block);
  assert.ok((await h.call(submit, submitInput("own"))).block);
  for (const id of ["foreign", "guessed", "stale", "other-pr", "other-repo"]) {
    assert.match((await h.call(inline, inlineInput(id))).reason, /review/i);
    assert.match((await h.call(submit, submitInput(id))).reason, /review/i);
  }
  assert.equal(await h.call(start, target, "b"), undefined);
  h.result("b", target, details(target, "another"));
  assert.ok((await h.call(inline, inlineInput("another", { repo: "other/repo" }))).block);
  assert.equal(h.lookups(), 0);
  const other = setup();
  assert.ok((await other.call(inline, inlineInput("another"))).block);
  assert.ok((await other.call(submit, submitInput("another"))).block);
  assert.ok((await setup(null).call(submit, submitInput("own"))).block);
});

test("concurrent starts are bound to their own PR and one-time call IDs", async () => {
  const h = setup();
  const second = { ...target, pullNumber: 8 };
  assert.equal(await h.call(start, target, "a"), undefined);
  assert.equal(await h.call(start, second, "b"), undefined);
  assert.ok((await h.call(start, target, "a"))?.block);
  h.result("b", target, details(second, "second"));
  h.result("a", target, details(target, "first"));
  assert.equal(await h.call(inline, inlineInput("first")), undefined);
  assert.equal(await h.call(inline, inlineInput("second", { pullNumber: 8 })), undefined);
  assert.ok((await h.call(inline, inlineInput("first", { pullNumber: 8 }))).block);
  assert.ok((await h.call(inline, inlineInput("second"))).block);
  assert.equal(await h.call(submit, submitInput("first")), undefined);
  assert.equal(await h.call(submit, submitInput("second")), undefined);
  h.result("a", target, details(target, "replayed"));
  assert.ok((await h.call(submit, submitInput("replayed"))).block);
});

test("start results must be allowed, successful, correlated and carry a bounded string id", async () => {
  const h = setup();
  assert.ok((await h.call(start, { ...target, repo: "other/repo" }, "blocked")).block);
  h.result("blocked", target, details(target, "wrong-input"));
  const cases = [
    ["failed", { ...details(target, "failed"), isError: true }],
    ["missing", { details: { ...target }, content: [] }],
    ["number", details(target, 42)],
    ["large", details(target, "x".repeat(257))],
    ["pr", details({ ...target, pullNumber: 8 }, "wrong-pr")],
    ["repo", details({ ...target, repo: "other/repo" }, "wrong-repo")],
    ["missing-repo", { details: { pullNumber: target.pullNumber, reviewId: "missing-repo" } }],
    ["missing-pr", { details: { repo: target.repo, reviewId: "missing-pr" } }],
  ];
  for (const [id, result] of cases) {
    assert.equal(await h.call(start, target, id), undefined);
    h.result(id, target, result);
  }
  for (const id of [
    "failed",
    "42",
    "x".repeat(257),
    "wrong-pr",
    "wrong-repo",
    "wrong-input",
    "missing-repo",
    "missing-pr",
  ]) {
    assert.ok((await h.call(inline, inlineInput(id))).block);
    assert.ok((await h.call(submit, submitInput(id))).block);
  }
  assert.equal(await h.call(start, target, "text-call"), undefined);
  h.result("text-call", target, {
    content: [{ type: "text", text: JSON.stringify({ ...target, reviewId: "text" }) }],
  });
  assert.equal(await h.call(inline, inlineInput("text")), undefined);
  assert.equal(await h.call(submit, submitInput("text")), undefined);
});

test("abandoned pending starts are evicted and late results fail closed", async () => {
  const h = setup();
  assert.equal(await h.call(start, target, "old"), undefined);
  for (let i = 0; i < 64; i++) assert.equal(await h.call(start, target, `new-${i}`), undefined);
  h.result("old", target, details(target, "evicted"));
  assert.ok((await h.call(inline, inlineInput("evicted"))).block);
  assert.ok((await h.call(submit, submitInput("evicted"))).block);
  h.result("new-0", target, details(target, "valid"));
  assert.equal(await h.call(submit, submitInput("valid")), undefined);
});

test("recorded review capacity fails closed for starts and concurrent results", async () => {
  const h = setup();
  assert.equal(await h.call(start, target, "late"), undefined);
  for (let i = 0; i < 256; i++) {
    const id = `review-${i}`;
    assert.equal(await h.call(start, target, id), undefined);
    h.result(id, target, details(target, id));
  }
  assert.match((await h.call(start, target, "full")).reason, /limit/i);
  h.result("late", target, details(target, "overflow"));
  assert.ok((await h.call(submit, submitInput("overflow"))).block);
  assert.equal(await h.call(submit, submitInput("review-0")), undefined);
  h.result("submit", submitInput("review-0"), { isError: false }, submit);
  assert.equal(await h.call(start, target, "after-submit"), undefined);
});

test("a blocked start cannot create provenance even if a success result is fabricated", async () => {
  const h = setup(policy, async () => {
    throw new Error("not ready");
  });
  assert.ok((await h.call(start, target, "blocked")).block);
  h.result("blocked", target, details(target, "forged"));
  h.result("fresh", target, details(target, "fresh"));
  const unblocked = setup();
  assert.ok((await unblocked.call(submit, submitInput("forged"))).block);
  assert.match((await h.call(submit, submitInput("forged"))).reason, /Review ID/);
  assert.match((await h.call(submit, submitInput("fresh"))).reason, /Review ID/);
});
