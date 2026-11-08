import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GITHUB_BASE_TOOLS } from "../../extensions/crew/crew/lib/github-base-tools.mjs";
import { authorizeRepositoryOperation } from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";
import { repositoryTargets } from "../../extensions/crew/env-runtime/lib/repository-targets.mjs";

const snapshot = JSON.parse(readFileSync(new URL("../fixtures/armory-operations.json", import.meta.url)));
const policy = { repo: "Owner/Repo", revision: "a".repeat(40), base: "main", branch: "crew/branch" };
const valid = {
  repo: policy.repo,
  revision: policy.revision,
  branch: policy.branch,
  head: policy.branch,
  base: policy.base,
  message: "message",
  pullNumber: 1,
  title: "title",
};

test("released operations, baseline and closed inventory agree", () => {
  const sorted = (values) => [...values].sort();
  assert.equal(Object.keys(snapshot.operations).length, 49);
  assert.deepEqual(sorted(Object.keys(snapshot.operations)), sorted(GITHUB_BASE_TOOLS));
  assert.deepEqual(sorted(Object.keys(repositoryTargets)), sorted(GITHUB_BASE_TOOLS));
});

test("every classified operation enforces its target boundary", () => {
  for (const [operation, target] of Object.entries(repositoryTargets)) {
    const fields = snapshot.operations[operation].fields;
    const input = Object.fromEntries(Object.entries(valid).filter(([key]) => key in fields));
    if (operation === "github_issue_create") input.bodyFile = "issues/body.md";
    if (target === "owner-repo") Object.assign(input, { owner: "Owner", repo: "Repo" });
    if (target === "deferred") {
      assert.throws(() => authorizeRepositoryOperation(operation, input, policy), /project/i, operation);
      continue;
    }
    assert.doesNotThrow(() => authorizeRepositoryOperation(operation, input, policy), operation);
    assert.throws(() => authorizeRepositoryOperation(operation, input), /authorization is required/, operation);
    assert.throws(() => authorizeRepositoryOperation(operation, null, policy), /input is required/, operation);
    if (target === "review-submit") continue; // reviewId provenance is not yet bound (issue #143).
    for (const badRepo of ["other/repo", "owner/repo", "Owner/Repo/", " Owner/Repo", null]) {
      assert.throws(() => authorizeRepositoryOperation(operation, { ...input, repo: badRepo }, policy), undefined, operation);
    }
    if (target === "owner-repo") {
      for (const owner of ["owner", "Owner/else", "", null])
        assert.throws(() => authorizeRepositoryOperation(operation, { ...input, owner }, policy), undefined, operation);
    }
  }
});

test("unknown operations and unsafe issue body paths fail closed", () => {
  assert.throws(() => authorizeRepositoryOperation("github_unknown", { repo: policy.repo }, policy), /unknown|unclassified/i);
  for (const bodyFile of ["/tmp/body", "../body", "a/../body", "a\nbody", "", "C:\\body", "a\\..\\body"])
    assert.throws(() => authorizeRepositoryOperation("github_issue_create", { repo: policy.repo, bodyFile }, policy));
});
