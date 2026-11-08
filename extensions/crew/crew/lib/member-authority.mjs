// Assembly authority is recorded unchanged in the launch config. The host may warn and narrow the default GitHub grant when its token is absent.
import { readFileSync } from "node:fs";
import { BASE_TOOLS_PROFILE } from "./base-tools-profile.mjs";
import { suiteGrants } from "./suite-grants.mjs";
import { GITHUB_BASE_TOOL_SET } from "./github-base-tools.mjs";

const roles = JSON.parse(readFileSync(new URL("../prompts/roles.json", import.meta.url), "utf8"));
const native = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
const github = "collaboration/pi-github-tools";
const gitOperations = new Set([
  "github_workspace_checkout",
  "github_git_status",
  "github_git_diff",
  "github_git_stage",
  "github_git_commit",
  "github_git_push",
  "github_pull_request_create",
]);

const implementationRoleDenied = new Set([
  "github_pull_request_comment",
  "github_pull_request_review",
  "github_pull_request_review_start",
  "github_pull_request_review_inline_comment",
  "github_pull_request_review_submit",
  "github_pull_request_merge",
]);
const workflowReads = ["github_workflow_runs_list", "github_workflow_run_view", "github_workflow_run_failed_log"];

export function validateMemberAuthority(automaton, role, requested = BASE_TOOLS_PROFILE) {
  const policy = roles[role];
  if (!policy) throw new Error(`Unknown role "${role}".`);
  const system = new Set();
  const operations = new Set(["github_issue_view"]);
  for (const tool of [...policy.tools, ...automaton.tools]) {
    if (native.has(tool)) system.add(tool);
    else if (GITHUB_BASE_TOOL_SET.has(tool) || gitOperations.has(tool)) operations.add(tool);
    else throw new Error(`Unknown policy capability "${tool}".`);
  }
  if (["developer", "integrator"].includes(role)) {
    for (const tool of workflowReads) operations.add(tool);
    for (const tool of implementationRoleDenied) operations.delete(tool);
  }
  for (const tool of BASE_TOOLS_PROFILE[0].operations) system.add(tool);
  const grants = suiteGrants(requested);
  for (const tool of grants.system ?? []) {
    if (!system.has(tool))
      throw new Error(`Crew assignment has a system operation outside ${role}'s capabilities: ${tool}.`);
  }
  for (const grant of grants.suites) {
    if (grant.suite !== github) throw new Error(`Unknown or unauthorized Crew suite: ${grant.suite}.`);
    for (const tool of grant.tools)
      if (!operations.has(tool))
        throw new Error(`Crew assignment has an Armory operation outside ${role}'s capabilities: ${tool}.`);
  }
  return { tools: grants.system ?? [], suiteGrants: grants.suites };
}
