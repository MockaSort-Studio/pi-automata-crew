// Common least-privilege starting profile for every Hall automaton. Future
// automaton/role profiles may add or narrow this explicit baseline.
export const BASE_TOOLS_PROFILE = Object.freeze([
  { suite: "system", operations: ["read", "grep", "find", "ls"] },
  { suite: "collaboration/pi-github-tools", operations: ["github_issue_view"] },
]);
