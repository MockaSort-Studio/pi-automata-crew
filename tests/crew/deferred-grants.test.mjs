import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateMemberAuthority } from "../../extensions/crew/crew/lib/member-authority.mjs";

const github = "collaboration/pi-github-tools";
const granted = (role, requested, tools = []) =>
  validateMemberAuthority({ tools }, role, requested).suiteGrants.flatMap((grant) => grant.tools);
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
    "github_project_fields",
  ],
  architect: [
    "github_discussion_comments",
    "github_discussion_view",
    "github_discussions_list",
    "github_discussion_post",
  ],
  reviewer: ["github_pull_request_checks_wait"],
};

test("a role is granted what its declarations list, by default or on request", () => {
  for (const [role, operations] of Object.entries(restored)) {
    for (const operation of operations) {
      assert.ok(granted(role).includes(operation), `${role} default ${operation}`);
      assert.deepEqual(granted(role, [{ suite: github, operations: [operation] }]), [operation]);
    }
  }
});

test("an operation no declaration lists cannot be granted, whatever it is", () => {
  for (const [role, operation] of [
    ["developer", "github_pull_request_merge"],
    ["developer", "github_pull_request_review_submit"],
    ["advisor", "github_git_push"],
    ["reviewer", "github_issue_create"],
  ])
    assert.throws(
      () => validateMemberAuthority({ tools: [] }, role, [{ suite: github, operations: [operation] }]),
      /outside/,
      `${role} ${operation}`,
    );
});
