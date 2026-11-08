import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GITHUB_BASE_TOOLS } from "../../extensions/crew/crew/lib/github-base-tools.mjs";
import { authorizeRepositoryOperation } from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";
import { repositoryTargets } from "../../extensions/crew/env-runtime/lib/repository-targets.mjs";

const snapshot = JSON.parse(readFileSync(new URL("../fixtures/armory-operations.json", import.meta.url)));
const policy = { repo: "Owner/Repo", revision: "a".repeat(40), base: "main", branch: "worker" };

test("released operations, base tools and closed inventory agree", () => {
  const names = Object.keys(snapshot.operations).sort();
  assert.equal(names.length, 49);
  assert.deepEqual([...GITHUB_BASE_TOOLS].sort(), names);
  assert.deepEqual(Object.keys(repositoryTargets).sort(), names);
});

test("every target is classified and fails closed", () => {
  for (const [operation, target] of Object.entries(repositoryTargets)) {
    assert.ok(["repo", "ownerRepo", "reviewInline", "reviewSubmit", "deferred"].includes(target));
    const schema = snapshot.operations[operation];
    const input = Object.fromEntries(schema.required.map((key) => [key, schema.fields[key] === "integer" ? 1 : "x"]));
    if ("repo" in input) input.repo = target === "ownerRepo" ? "Repo" : policy.repo;
    if ("owner" in input) input.owner = "Owner";
    if ("revision" in input) input.revision = policy.revision;
    if ("branch" in input) input.branch = policy.branch;
    if ("head" in input) input.head = policy.branch;
    if ("base" in input) input.base = policy.base;
    if ("paths" in input) input.paths = ["file"];
    if (operation === "github_pull_request_update") input.title = "title";
    if (target !== "deferred") assert.doesNotThrow(() => authorizeRepositoryOperation(operation, input, policy), operation);
    assert.throws(() => authorizeRepositoryOperation(operation, input), /authorization/);
    assert.throws(() => authorizeRepositoryOperation(operation, null, policy));
    if (target === "deferred") assert.throws(() => authorizeRepositoryOperation(operation, input, policy), /deferred/);
    if (["repo", "ownerRepo", "reviewInline"].includes(target)) {
      for (const repo of ["other/repo", "owner/repo", "Owner/Repo/", " Owner/Repo", ""]) {
        assert.throws(() => authorizeRepositoryOperation(operation, { ...input, repo }, policy));
      }
    }
  }
  assert.throws(() => authorizeRepositoryOperation("github_unknown", {}, policy), /unknown|unclassified/i);
});

test("discussion, review and issue paths preserve authorized flows", () => {
  const allow = (op, input) => assert.doesNotThrow(() => authorizeRepositoryOperation(op, input, policy));
  allow("github_issue_view", { repo: policy.repo });
  allow("github_discussion_view", { owner: "Owner", repo: "Repo" });
  assert.throws(() => authorizeRepositoryOperation("github_discussion_view", { owner: "Other", repo: "Repo" }, policy));
  allow("github_pull_request_review_inline_comment", { repo: policy.repo, pullNumber: 1, reviewId: "id" });
  assert.throws(() => authorizeRepositoryOperation("github_pull_request_review_inline_comment", { repo: policy.repo, pullNumber: 0 }, policy));
  allow("github_pull_request_review_submit", { reviewId: "id" });
  allow("github_issue_create", { repo: policy.repo, bodyFile: "issues/body.md" });
  for (const bodyFile of ["/tmp/x", "../x", "a/../x", "x\ny", "C:\\outside", "a\\..\\x"]) {
    assert.throws(() => authorizeRepositoryOperation("github_issue_create", { repo: policy.repo, bodyFile }, policy));
  }
});
