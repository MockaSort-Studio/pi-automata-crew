import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GITHUB_BASE_TOOLS } from "../../extensions/crew/crew/lib/github-base-tools.mjs";
import { validateMemberAuthority } from "../../extensions/crew/crew/lib/member-authority.mjs";
import { getAutomaton } from "../../extensions/crew/crew/lib/roster.mjs";
import { assemble } from "../../extensions/crew/crew/lib/assembly.mjs";
import { prepareCrew } from "../../extensions/crew/crew/lib/startup.mjs";

const roles = JSON.parse(readFileSync(new URL("../../extensions/crew/crew/prompts/roles.json", import.meta.url)));
const words = (value) => value.trim().split(/\s+/);
const native = words("read grep find ls bash edit write");
const common = "read grep find ls";
const developer = `${common} bash edit write github_workspace_checkout github_git_status github_git_diff github_git_stage github_git_commit github_git_push github_pull_request_create github_pull_requests_list github_pull_request_view github_pull_request_files github_pull_request_checks github_pull_request_checks_wait github_pull_request_review_threads github_pull_request_update github_pull_request_add_label github_pull_request_remove_label github_issue_view github_issues_list github_workflow_runs_list github_workflow_run_view github_workflow_run_failed_log`;
const expected = {
  lead: `${common} github_issues_list github_issue_view github_issue_create github_issue_update github_issue_comment github_issue_add_label github_issue_remove_label github_label_list github_subissue_add github_subissues_list github_dependency_add github_dependency_list github_project_fields github_project_item_add github_project_item_find github_project_field_set github_pull_requests_list github_pull_request_view github_pull_request_checks`,
  architect: `${common} github_issue_view github_issues_list github_discussions_list github_discussion_view github_discussion_comments github_discussion_post github_subissues_list github_dependency_list github_pull_requests_list github_pull_request_view github_pull_request_files`,
  advisor: `${common} github_issue_view github_issues_list github_discussions_list github_discussion_view github_discussion_comments github_pull_requests_list github_pull_request_view github_pull_request_files github_pull_request_checks github_workflow_runs_list github_workflow_run_view`,
  developer,
  integrator: developer,
  reviewer: `${common} bash github_issue_view github_pull_request_view github_pull_request_files github_pull_request_checks github_pull_request_checks_wait github_pull_request_review_threads github_pull_request_review_start github_pull_request_review_inline_comment github_pull_request_review_submit github_pull_request_comment github_workflow_runs_list github_workflow_run_view github_workflow_run_failed_log`,
};
const sorted = (items) => [...items].sort();
const github = "collaboration/pi-github-tools";
const operations = words(`
  github_repo_discussions_set github_discussion_comments github_discussion_post github_discussion_view
  github_discussions_list github_discussion_delete github_issue_create github_issue_view github_subissue_add
  github_subissues_list github_dependency_add github_issues_list github_dependency_list github_issue_comment
  github_issue_update github_label_list github_label_create github_label_update github_issue_add_label
  github_issue_remove_label github_project_fields github_project_item_add github_project_item_find
  github_project_field_set github_pull_requests_list github_pull_request_view github_pull_request_files
  github_pull_request_checks github_pull_request_checks_wait github_pull_request_review_threads
  github_pull_request_comment github_pull_request_update github_pull_request_review_start
  github_pull_request_review_inline_comment github_pull_request_review_submit github_pull_request_review
  github_pull_request_merge github_pull_request_add_label github_pull_request_remove_label github_workflow_runs_list
  github_workflow_run_view github_workflow_run_failed_log github_pull_request_create github_workspace_checkout
  github_git_status github_git_diff github_git_stage github_git_commit github_git_push
`);

test("role policies match the prescribed table and invariants", () => {
  assert.equal(GITHUB_BASE_TOOLS.length, 49);
  assert.deepEqual(sorted(GITHUB_BASE_TOOLS), sorted(operations));
  assert.equal(new Set(GITHUB_BASE_TOOLS).size, 49);
  assert.deepEqual(sorted(Object.keys(roles)), sorted(Object.keys(expected)));
  for (const [role, policy] of Object.entries(roles)) {
    assert.deepEqual(sorted(policy.tools), sorted(words(expected[role])), role);
    for (const tool of policy.tools) {
      assert.ok(native.includes(tool) || GITHUB_BASE_TOOLS.includes(tool), `${role}: ${tool}`);
      assert.ok(!["github_pull_request_merge", "github_pull_request_review"].includes(tool));
      if (!["developer", "integrator"].includes(role)) {
        const restricted = words(`
          edit write github_workspace_checkout github_pull_request_create github_pull_request_update
        `);
        assert.ok(!restricted.includes(tool));
        assert.ok(!tool.startsWith("github_git_"));
      }
      if (tool.startsWith("github_pull_request_review_") && tool !== "github_pull_request_review_threads") {
        assert.equal(role, "reviewer");
      }
      if (["lead", "architect", "advisor"].includes(role)) assert.ok(!["bash", "edit", "write"].includes(tool));
    }
  }
});

test("defaults grant the role and persona union in assembly and launch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "role-tools-"));
  try {
    for (const role of ["developer", "reviewer"]) {
      const persona = getAutomaton("snowball");
      const union = new Set(
        [...roles[role].tools, ...persona.tools].filter(
          (tool) =>
            ![
              "github_issues_list",
              "github_pull_request_checks_wait",
              "github_pull_request_comment",
              "github_pull_request_review_start",
              "github_pull_request_review_inline_comment",
              "github_pull_request_review_submit",
            ].includes(tool),
        ),
      );
      const actor = assemble("snowball", role, "");
      const prepared = await prepareCrew(
        { getAllTools: () => [] },
        { members: [{ name: "snowball", role }] },
        { cwd },
        ".pi",
      );
      for (const result of [actor, prepared.agents[0]]) {
        assert.deepEqual(sorted(result.tools), sorted([...union].filter((tool) => native.includes(tool))));
        assert.deepEqual(
          sorted(result.suiteGrants.flatMap((grant) => grant.tools)),
          sorted([...union].filter((tool) => !native.includes(tool))),
        );
        assert.ok(result.suiteGrants.every((grant) => grant.suite === github));
      }
      assert.equal(prepared.agents[0].grantsExplicit, false);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("reviewer mutations stay explicit opt-ins rather than new defaults", () => {
  const mutations = words(
    "github_pull_request_comment github_pull_request_review_start github_pull_request_review_inline_comment github_pull_request_review_submit",
  );
  const persona = { tools: [] };
  const defaults = validateMemberAuthority(persona, "reviewer").suiteGrants.flatMap((grant) => grant.tools);
  assert.ok(mutations.every((operation) => !defaults.includes(operation)));
  assert.deepEqual(
    validateMemberAuthority(persona, "reviewer", [{ suite: github, operations: mutations }]).suiteGrants,
    [{ suite: github, tools: mutations }],
  );
});

test("explicit grants narrow authority and unknown policy operations are rejected", () => {
  const persona = { tools: ["github_pull_requests_list"] };
  assert.ok(validateMemberAuthority(persona, "reviewer").suiteGrants[0].tools.includes("github_pull_requests_list"));
  const narrow = validateMemberAuthority(persona, "reviewer", [{ suite: "system", operations: ["read"] }]);
  assert.deepEqual(narrow.tools, ["read"]);
  assert.throws(
    () => validateMemberAuthority(persona, "reviewer", [{ suite: github, operations: ["github_git_push"] }]),
    /Armory operation outside reviewer's capabilities/,
  );
  assert.throws(() => validateMemberAuthority({ tools: ["github_not_real"] }, "reviewer"), /Unknown policy capability/);
});
