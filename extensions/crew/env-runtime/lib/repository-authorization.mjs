import { repositoryTargets } from "./repository-targets.mjs";

// Typed Git workspace operations a developer worker may invoke. A worker edits files with the
// sandboxed read/edit/write tools and only checks out, stages, commits and pushes through these
// typed guest operations, plus one pull-request creation call.
const gitWorkspaceOperations = new Set([
  "github_workspace_checkout",
  "github_git_status",
  "github_git_diff",
  "github_git_stage",
  "github_git_commit",
  "github_git_push",
]);
export const readPullRequestOperations = new Set([
  "github_pull_requests_list",
  "github_pull_request_view",
  "github_pull_request_files",
  "github_pull_request_checks",
  "github_pull_request_review_threads",
]);
export const ownPullRequestOperations = new Set([
  "github_pull_request_update",
  "github_pull_request_add_label",
  "github_pull_request_remove_label",
]);
const guardedOperations = new Set([
  ...gitWorkspaceOperations,
  "github_pull_request_create",
  ...readPullRequestOperations,
  ...ownPullRequestOperations,
  "github_workflow_runs_list",
  "github_workflow_run_view",
  "github_workflow_run_failed_log",
]);

// Every guarded operation accepts exactly these fields. Anything else, including ref-like fields
// such as sha/force/remote/refspec, is rejected before any field-level check runs.
const allowedKeysByOperation = {
  github_workspace_checkout: new Set(["repo", "revision", "branch"]),
  github_git_status: new Set(["repo"]),
  github_git_diff: new Set(["repo", "paths"]),
  github_git_stage: new Set(["repo", "paths"]),
  github_git_commit: new Set(["repo", "message"]),
  github_git_push: new Set(["repo", "branch"]),
  github_pull_request_create: new Set(["repo", "head", "base", "title", "body", "draft"]),
  github_pull_requests_list: new Set(["repo", "state", "limit"]),
  github_pull_request_view: new Set(["repo", "pullNumber"]),
  github_pull_request_files: new Set(["repo", "pullNumber"]),
  github_pull_request_checks: new Set(["repo", "pullNumber"]),
  github_workflow_runs_list: new Set(["repo", "workflow", "limit"]),
  github_workflow_run_view: new Set(["repo", "runId"]),
  github_workflow_run_failed_log: new Set(["repo", "runId", "maxChars"]),
  github_pull_request_review_threads: new Set(["repo", "pullNumber", "includeResolved"]),
  github_pull_request_update: new Set(["repo", "pullNumber", "title", "body", "state"]),
  github_pull_request_add_label: new Set(["repo", "pullNumber", "labels"]),
  github_pull_request_remove_label: new Set(["repo", "pullNumber", "label"]),
};

export function repositoryAuthorization(value) {
  if (!value) return undefined;
  if (
    typeof value.repo !== "string" ||
    !/^[^/\s]+\/[^/\s]+$/.test(value.repo) ||
    typeof value.revision !== "string" ||
    !/^[0-9a-f]{40}$/i.test(value.revision) ||
    typeof value.base !== "string" ||
    !value.base ||
    typeof value.branch !== "string" ||
    !value.branch
  )
    throw new Error("Worker repository authorization is invalid");
  return { repo: value.repo, revision: value.revision, base: value.base, branch: value.branch };
}

// A path is a plain workspace-relative file path: no absolute path, no traversal, no Git pathspec
// magic (":(top)", ":!x"), no option-looking value, no control characters.
const safeWorkspacePath = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  path.length <= 4096 &&
  !path.startsWith("/") &&
  !path.startsWith(":") &&
  !path.startsWith("-") &&
  !/[\0-\x1f\x7f]/.test(path) &&
  !path.split("/").some((part) => part === "..");

function assertKnownShape(operation, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(`Repository operation input is required for ${operation}`);
  const allowed = allowedKeysByOperation[operation];
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`${operation} does not accept "${key}"`);
  if ("paths" in input && (!Array.isArray(input.paths) || !input.paths.every(safeWorkspacePath)))
    throw new Error(`${operation} paths must be workspace-relative file paths`);
}

// Armory remains generic. This trusted Env projection is the only place that binds generic
// GitHub operations to one worker's repository, revision, base and derived branch.
export function authorizeRepositoryOperation(operation, input, policy) {
  const target = Object.hasOwn(repositoryTargets, operation) && repositoryTargets[operation];
  if (!target) throw new Error(`Unclassified repository operation: ${operation}`);
  if (!policy) throw new Error(`Repository authorization is required for ${operation}`);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(`Repository operation input is required for ${operation}`);
  if (target === "deferred") throw new Error(`Repository operation is deferred: ${operation}`);
  if (guardedOperations.has(operation)) assertKnownShape(operation, input);
  if (target === "ownerRepo") {
    if (
      typeof input.owner !== "string" ||
      typeof input.repo !== "string" ||
      !/^[^/\s]+$/.test(input.owner) ||
      !/^[^/\s]+$/.test(input.repo) ||
      `${input.owner}/${input.repo}` !== policy.repo
    )
      throw new Error("Repository operation is outside the worker authorization");
  } else if (target !== "reviewSubmit" && input.repo !== policy.repo) {
    throw new Error("Repository operation is outside the worker authorization");
  }
  if (target === "reviewInline" && (!Number.isInteger(input.pullNumber) || input.pullNumber <= 0))
    throw new Error("pullNumber must be a positive integer");
  // bodyFile is checked lexically on purpose. Where it is read is already isolated: the host-side suite reads
  // through the in-memory workspace VFS (a symlink to a host path is unreadable, see
  // gondolin-private-workspace.test.mjs), and the retained guest-suite path reads inside the member's own VM
  // with the member's own privileges, where the member can already read the same file with bash. A symlink
  // therefore never reaches anything the member could not already read.
  if (operation === "github_issue_create" && (!safeWorkspacePath(input.bodyFile) || input.bodyFile.includes("\\")))
    throw new Error("bodyFile must be a workspace-relative file path");
  if (
    (readPullRequestOperations.has(operation) || ownPullRequestOperations.has(operation)) &&
    operation !== "github_pull_requests_list" &&
    (!Number.isInteger(input.pullNumber) || input.pullNumber <= 0)
  )
    throw new Error("pullNumber must be a positive integer");
  if (operation === "github_pull_requests_list") {
    if ("state" in input && !["open", "closed", "merged", "all"].includes(input.state))
      throw new Error("Invalid list state");
    if ("limit" in input && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))
      throw new Error("Invalid list limit");
  }
  if (operation === "github_workflow_runs_list") {
    if ("workflow" in input && typeof input.workflow !== "string") throw new Error("Invalid workflow");
    if ("limit" in input && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100))
      throw new Error("Invalid list limit");
  }
  if (operation === "github_workflow_run_view" || operation === "github_workflow_run_failed_log") {
    if (!Number.isSafeInteger(input.runId) || input.runId <= 0) throw new Error("Invalid runId");
  }
  if (
    operation === "github_workflow_run_failed_log" &&
    "maxChars" in input &&
    (!Number.isInteger(input.maxChars) || input.maxChars < 1 || input.maxChars > 12000)
  )
    throw new Error("Invalid maxChars");
  if (operation === "github_pull_request_update") {
    if (!["title", "body", "state"].some((key) => key in input))
      throw new Error("Update requires title, body or state");
    if ("state" in input && !["open", "closed"].includes(input.state)) throw new Error("Invalid update state");
  }
  if (
    operation === "github_workspace_checkout" &&
    (input.revision !== policy.revision || input.branch !== policy.branch)
  )
    throw new Error("Workspace checkout is outside the worker authorization");
  if (operation === "github_git_commit" && (typeof input.message !== "string" || !input.message.trim()))
    throw new Error("Commit requires a message");
  if (operation === "github_git_push" && input.branch !== policy.branch)
    throw new Error("Push is outside the worker authorization");
  if (operation === "github_pull_request_create" && (input.head !== policy.branch || input.base !== policy.base))
    throw new Error("Pull request is outside the worker authorization");
}
