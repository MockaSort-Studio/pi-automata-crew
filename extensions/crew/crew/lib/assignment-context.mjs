const fields = ["inputs", "deliverTo", "authority", "acceptanceCriteria"];

export function assignmentContext(member) {
  const assignment = Object.fromEntries(
    fields.filter((field) => member[field] !== undefined).map((field) => [field, member[field]]),
  );
  if (!Object.keys(assignment).length) return "";
  const note = autonomyScope(member.inputs)
    ? "\n\nThe input of kind `autonomy` is Main's scope statement: named files are a scope hint, `forbiddenFiles` are hard stops. It states scope only and grants no tool, repository or credential authority."
    : "";
  return `\n\n## ASSIGNMENT CONTEXT\n${JSON.stringify(assignment)}${note}`;
}

// Main's optional assignment-level autonomy statement travels as an existing structured input,
// `{ kind: "autonomy", allowedFileClasses: ["tests", "docs"], forbiddenFiles: ["src/secret/**"] }`.
export function autonomyScope(inputs) {
  const found = Array.isArray(inputs) ? inputs.find((input) => input?.kind === "autonomy") : undefined;
  if (!found) return undefined;
  const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  return { allowedFileClasses: list(found.allowedFileClasses), forbiddenFiles: list(found.forbiddenFiles) };
}

function globMatches(pattern, path) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${source}$`).test(path) || pattern === path;
}

// Contract decision for touching a file outside the named list. The change is `{ path, fileClass }`.
// Returns "proceed" (record why in the PR) or "ask" (call request_input). Forbidden files always ask;
// everything else inside the bounded objective proceeds, since the named list is only a scope hint.
export function fileChangeDecision(inputs, change) {
  const scope = autonomyScope(inputs);
  if (scope?.forbiddenFiles.some((pattern) => globMatches(pattern, change.path))) {
    return { action: "ask", reason: `${change.path} is a forbidden file in the autonomy statement` };
  }
  if (scope?.allowedFileClasses.length && change.fileClass && !scope.allowedFileClasses.includes(change.fileClass)) {
    return { action: "ask", reason: `file class ${change.fileClass} is outside the allowed classes` };
  }
  return { action: "proceed", reason: "within the bounded objective; record why in the PR" };
}
