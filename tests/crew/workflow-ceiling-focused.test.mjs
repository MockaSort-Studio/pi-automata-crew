import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMemberAuthority } from "../../extensions/crew/crew/lib/member-authority.mjs";

const suite = "collaboration/pi-github-tools";
const grants = (operation) => [{ suite, operations: [operation] }];

test("implementation roles admit workflow reads but never persona-supplied review or merge writes", () => {
  for (const role of ["developer", "integrator"]) {
    for (const operation of ["github_workflow_runs_list", "github_workflow_run_view", "github_workflow_run_failed_log"])
      assert.doesNotThrow(() => validateMemberAuthority({ tools: [] }, role, grants(operation)));
    for (const operation of ["github_pull_request_comment", "github_pull_request_review", "github_pull_request_review_start", "github_pull_request_review_inline_comment", "github_pull_request_review_submit", "github_pull_request_merge"])
      assert.throws(() => validateMemberAuthority({ tools: [operation] }, role, grants(operation)));
  }
});
