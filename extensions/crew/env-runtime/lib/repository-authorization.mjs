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
// The API write workflow is retired for repository-bound workers: Contents API writes each
// advance the branch ref and race. They stay guarded so a stray grant can never run unchecked.
const retiredOperations = new Set(["github_ref_create", "github_file_update"]);
const guardedOperations = new Set([
  ...gitWorkspaceOperations,
  ...retiredOperations,
  "github_workspace_snapshot",
  "github_pull_request_create",
]);

// Every guarded operation accepts exactly these fields. Anything else, including ref-like fields
// such as sha/force/remote/refspec, is rejected before any field-level check runs.
const allowedKeysByOperation = {
  github_workspace_snapshot: new Set(["repo", "revision"]),
  github_workspace_checkout: new Set(["repo", "revision", "branch"]),
  github_git_status: new Set(["repo"]),
  github_git_diff: new Set(["repo", "paths"]),
  github_git_stage: new Set(["repo", "paths"]),
  github_git_commit: new Set(["repo", "message", "paths"]),
  github_git_push: new Set(["repo", "branch"]),
  github_pull_request_create: new Set(["repo", "head", "base", "title", "body", "draft"]),
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
  if (!guardedOperations.has(operation)) return;
  if (!policy) throw new Error(`Repository authorization is required for ${operation}`);
  if (retiredOperations.has(operation))
    throw new Error(`${operation} is retired for repository workers; use the typed Git workspace operations`);
  assertKnownShape(operation, input);
  if (input.repo !== policy.repo) throw new Error("Repository operation is outside the worker authorization");
  if (operation === "github_workspace_snapshot" && input.revision !== policy.revision)
    throw new Error("Workspace snapshot revision is outside the worker authorization");
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
