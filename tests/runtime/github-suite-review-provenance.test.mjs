import { strict as assert } from "node:assert";
import test from "node:test";
import { githubSuiteExtension } from "../../extensions/crew/runner/github-suite.mjs";

const policy = { repo: "owner/repo", branch: "crew/worker", base: "main" };
const start = "github_pull_request_review_start";
const inline = "github_pull_request_review_inline_comment";
const submit = "github_pull_request_review_submit";

function setup(currentPolicy = policy) {
  const handlers = new Map();
  let lookups = 0;
  githubSuiteExtension({
    module: { activateSuite() {} },
    workspace: {},
    token: "t",
    policy: currentPolicy,
    transport: { run: async () => (lookups++, "") },
  })({ on: (name, handler) => handlers.set(name, handler) });
  return {
    call: (toolName, input) => handlers.get("tool_call")({ toolName, input }),
    result: (input, extra, toolName = start) => handlers.get("tool_result")({ toolName, input, ...extra }),
    lookups: () => lookups,
  };
}

const target = { repo: policy.repo, pullNumber: 7 };
const inlineInput = (reviewId, extra = {}) => ({ ...target, reviewId, path: "a", line: 1, body: "fix", ...extra });
const submitInput = (reviewId) => ({ reviewId, event: "COMMENT", hasBlockingFindings: false });

test("review mutations require provenance from this instance's authorized start", async () => {
  const h = setup();
  assert.equal(await h.call(start, target), undefined);
  h.result(target, { details: { ...target, reviewId: "own" }, content: [], isError: false });
  for (let i = 0; i < 3; i++) assert.equal(await h.call(inline, inlineInput("own")), undefined);
  assert.equal(await h.call(submit, submitInput("own")), undefined);
  h.result(submitInput("own"), { isError: false }, submit);
  assert.ok((await h.call(inline, inlineInput("own"))).block);
  assert.ok((await h.call(submit, submitInput("own"))).block);
  for (const id of ["foreign", "guessed", "stale", "other-pr", "other-repo"]) {
    assert.match((await h.call(inline, inlineInput(id))).reason, /review/i);
    assert.match((await h.call(submit, submitInput(id))).reason, /review/i);
  }
  h.result(target, { details: { ...target, reviewId: "another" }, isError: false });
  assert.match((await h.call(inline, inlineInput("another", { pullNumber: 8 }))).reason, /review/i);
  assert.ok((await h.call(inline, inlineInput("another", { repo: "other/repo" }))).block);
  assert.equal(h.lookups(), 0);
  const other = setup();
  assert.ok((await other.call(inline, inlineInput("another"))).block);
  assert.ok((await other.call(submit, submitInput("another"))).block);
  assert.ok((await setup(null).call(submit, submitInput("own"))).block);
});

test("start results must be successful, correlated and carry a string id", async () => {
  const h = setup();
  assert.ok((await h.call(start, { ...target, repo: "other/repo" })).block);
  h.result(target, { isError: true, details: { ...target, reviewId: "failed" } });
  h.result(target, { details: { ...target }, content: [] });
  h.result(target, { details: { ...target, reviewId: 42 } });
  h.result(target, { details: { ...target, pullNumber: 8, reviewId: "mismatch" } });
  h.result({ ...target, repo: "other/repo" }, { details: { ...target, reviewId: "wrong-input" } });
  for (const id of ["failed", "42", "mismatch", "wrong-input"]) {
    assert.ok((await h.call(inline, inlineInput(id))).block);
    assert.ok((await h.call(submit, submitInput(id))).block);
  }
  h.result(target, { content: [{ type: "text", text: JSON.stringify({ ...target, reviewId: "text" }) }] });
  assert.equal(await h.call(inline, inlineInput("text")), undefined);
  assert.equal(await h.call(submit, submitInput("text")), undefined);
});
