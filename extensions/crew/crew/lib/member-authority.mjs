// Assembly authority is recorded unchanged in the launch config. The host may warn and narrow the default GitHub grant when its token is absent.
import { readFileSync } from "node:fs";
import { suiteGrants } from "./suite-grants.mjs";
import { GITHUB_BASE_TOOL_SET } from "./github-base-tools.mjs";
import { repositoryTargets } from "../../env-runtime/lib/repository-targets.mjs";
import { NATIVE_TOOLS as native } from "./required-capabilities.mjs";

const roles = JSON.parse(readFileSync(new URL("../prompts/roles.json", import.meta.url), "utf8"));
const github = "collaboration/pi-github-tools";
const personaReads = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "github_discussion_comments",
  "github_discussion_view",
  "github_discussions_list",
  "github_issue_view",
  "github_subissues_list",
  "github_issues_list",
  "github_dependency_list",
  "github_label_list",
  "github_project_fields",
  "github_project_item_find",
  "github_pull_requests_list",
  "github_pull_request_view",
  "github_pull_request_files",
  "github_pull_request_checks",
  "github_pull_request_checks_wait",
  "github_pull_request_review_threads",
  "github_workflow_runs_list",
  "github_workflow_run_view",
  "github_workflow_run_failed_log",
]);
const deferredOperations = new Set(
  Object.entries(repositoryTargets)
    .filter(([, target]) => target === "deferred")
    .map(([operation]) => operation),
);
const implementationRoleCeiling = new Set([
  "github_pull_request_comment",
  "github_pull_request_review",
  "github_pull_request_review_start",
  "github_pull_request_review_inline_comment",
  "github_pull_request_review_submit",
  "github_pull_request_merge",
]);
export function validateMemberAuthority(automaton, role, requested) {
  const policy = roles[role];
  if (!policy) throw new Error(`Unknown role "${role}".`);
  const system = new Set();
  const operations = new Set();
  for (const tool of automaton.tools) {
    if (!native.has(tool) && !GITHUB_BASE_TOOL_SET.has(tool)) throw new Error(`Unknown policy capability "${tool}".`);
  }
  for (const tool of [...policy.tools, ...automaton.tools.filter((tool) => personaReads.has(tool))]) {
    if (native.has(tool)) system.add(tool);
    else if (GITHUB_BASE_TOOL_SET.has(tool)) {
      if (
        !deferredOperations.has(tool) &&
        !(["developer", "integrator"].includes(role) && implementationRoleCeiling.has(tool))
      )
        operations.add(tool);
    } else throw new Error(`Unknown policy capability "${tool}".`);
  }
  // Existing reviewer mutations remain explicit opt-ins until effective targets are confined.
  const reviewerExplicitOnly = new Set([
    "github_pull_request_comment",
    "github_pull_request_review_start",
    "github_pull_request_review_inline_comment",
    "github_pull_request_review_submit",
  ]);
  const defaultOperations = [...operations].filter((tool) => role !== "reviewer" || !reviewerExplicitOnly.has(tool));
  const defaults = [
    ...(system.size ? [{ suite: "system", operations: [...system] }] : []),
    ...(defaultOperations.length ? [{ suite: github, operations: defaultOperations }] : []),
  ];
  const grants = suiteGrants(requested === undefined ? defaults : requested);
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
