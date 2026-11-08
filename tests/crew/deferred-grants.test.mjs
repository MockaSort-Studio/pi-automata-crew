import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateMemberAuthority } from "../../extensions/crew/crew/lib/member-authority.mjs";
import { authorizeRepositoryOperation } from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";
import { repositoryTargets } from "../../extensions/crew/env-runtime/lib/repository-targets.mjs";

const github = "collaboration/pi-github-tools";
const snapshot = JSON.parse(readFileSync(new URL("../fixtures/armory-operations.json", import.meta.url)));
const policy = { repo: "Owner/Repo", revision: "a".repeat(40), base: "main", branch: "worker" };
const restored = {
  lead: [
    "github_issues_list",
    "github_subissues_list",
    "github_dependency_list",
    "github_label_list",
    "github_issue_create",
    "github_issue_update",
    "github_issue_comment",
    "github_issue_add_label",
    "github_issue_remove_label",
    "github_subissue_add",
    "github_dependency_add",
  ],
  architect: [
    "github_discussion_comments",
    "github_discussion_view",
    "github_discussions_list",
    "github_discussion_post",
  ],
  reviewer: ["github_pull_request_checks_wait"],
};

test("restored role grants are confined for every released operation", () => {
  for (const [role, operations] of Object.entries(restored)) {
    for (const operation of operations) {
      const target = repositoryTargets[operation];
      assert.ok(["repo", "ownerRepo"].includes(target), operation);
      const schema = snapshot.operations[operation];
      const input = Object.fromEntries(schema.required.map((key) => [key, schema.fields[key] === "integer" ? 1 : "x"]));
      input.repo = target === "ownerRepo" ? "Repo" : policy.repo;
      if (target === "ownerRepo") input.owner = "Owner";
      assert.ok(
        validateMemberAuthority({ tools: [] }, role).suiteGrants.flatMap((grant) => grant.tools).includes(operation),
      );
      assert.doesNotThrow(() => validateMemberAuthority({ tools: [] }, role, [{ suite: github, operations: [operation] }]));
      assert.doesNotThrow(() => authorizeRepositoryOperation(operation, input, policy));
      assert.throws(() => authorizeRepositoryOperation(operation, { ...input, repo: "Other" }, policy));
      assert.throws(() => authorizeRepositoryOperation(operation, input), /authorization/);
    }
  }
});

test("inventory deferred operations cannot be granted", () => {
  for (const [operation, target] of Object.entries(repositoryTargets)) {
    if (target !== "deferred") continue;
    for (const role of ["lead", "architect", "advisor", "developer", "integrator", "reviewer"]) {
      assert.ok(
        !validateMemberAuthority({ tools: [operation] }, role).suiteGrants
          .flatMap((grant) => grant.tools)
          .includes(operation),
      );
      assert.throws(() =>
        validateMemberAuthority({ tools: [operation] }, role, [{ suite: github, operations: [operation] }]),
      );
    }
  }
});
