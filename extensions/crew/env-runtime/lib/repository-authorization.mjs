const writeOperations = new Set(["github_ref_create", "github_file_update", "github_pull_request_create"]);
const guardedOperations = new Set(["github_workspace_snapshot", ...writeOperations]);

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

// Armory remains generic. This trusted Env projection is the only place that
// binds generic GitHub operations to one worker's repository/ref lifecycle.
export function authorizeRepositoryOperation(operation, input, policy) {
  if (!guardedOperations.has(operation)) return;
  if (!policy) throw new Error(`Repository authorization is required for ${operation}`);
  if (input?.repo !== policy.repo) throw new Error("Repository operation is outside the worker authorization");
  if (operation === "github_workspace_snapshot" && input.revision !== policy.revision)
    throw new Error("Workspace snapshot revision is outside the worker authorization");
  if (operation === "github_ref_create" && (input.branch !== policy.branch || input.sha !== policy.revision))
    throw new Error("Branch creation is outside the worker authorization");
  if (operation === "github_file_update" && input.branch !== policy.branch)
    throw new Error("File update is outside the worker authorization");
  if (operation === "github_pull_request_create" && (input.head !== policy.branch || input.base !== policy.base))
    throw new Error("Pull request is outside the worker authorization");
}
