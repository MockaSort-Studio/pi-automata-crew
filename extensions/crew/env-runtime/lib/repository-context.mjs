// The repository a crew works in, as launch configuration: where the workspace is seeded from and which branch a
// member's work is saved to. This describes the assignment; it grants nothing. What a member may call is its
// declared tool list, and nothing here inspects a tool's inputs.
export function repositoryContext(value) {
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
    throw new Error("Worker repository context is invalid");
  return { repo: value.repo, revision: value.revision, base: value.base, branch: value.branch };
}
