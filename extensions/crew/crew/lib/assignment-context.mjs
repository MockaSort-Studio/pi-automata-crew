const fields = ["inputs", "deliverTo", "authority", "acceptanceCriteria"];
const CLASS = /^[a-z][a-z0-9_-]*$/;

export function assignmentContext(member) {
  const assignment = Object.fromEntries(
    fields.filter((field) => member[field] !== undefined).map((field) => [field, member[field]]),
  );
  if (!Object.keys(assignment).length) return "";
  return `\n\n## ASSIGNMENT CONTEXT\n${JSON.stringify(assignment)}${autonomySection(member.inputs)}`;
}

// Main's optional assignment-level autonomy statement travels as an existing structured input:
// `{ kind: "autonomy", allowedFileClasses: ["tests", "docs"], forbiddenFiles: ["src/secret/**"] }`.
// It is scope guidance for the member, not an access-control list: nothing in the runtime enforces it,
// and it grants no tool, repository or credential authority. Invalid or ambiguous statements are rejected
// at assembly so a malformed list can never silently widen scope.
export function autonomyScope(inputs) {
  const statements = Array.isArray(inputs) ? inputs.filter((input) => input?.kind === "autonomy") : [];
  if (!statements.length) return undefined;
  if (statements.length > 1) throw new Error("autonomy: more than one autonomy statement is ambiguous");
  const { allowedFileClasses, forbiddenFiles } = statements[0];
  if (allowedFileClasses === undefined && forbiddenFiles === undefined) {
    throw new Error("autonomy: statement must list allowedFileClasses and/or forbiddenFiles");
  }
  return {
    allowedFileClasses: list("allowedFileClasses", allowedFileClasses, fileClass),
    forbiddenFiles: list("forbiddenFiles", forbiddenFiles, forbiddenPattern),
  };
}

function list(name, value, normalize) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) throw new Error(`autonomy: ${name} must be a non-empty array`);
  return [...new Set(value.map((item) => normalize(name, item)))];
}

function fileClass(name, value) {
  if (typeof value !== "string" || !CLASS.test(value)) throw new Error(`autonomy: invalid ${name} entry`);
  return value;
}

// Forbidden patterns are repo-relative POSIX paths or globs. Backslashes, absolute paths, and `..` segments
// are rejected rather than guessed at; a leading `./` is stripped.
function forbiddenPattern(name, value) {
  if (typeof value !== "string") throw new Error(`autonomy: invalid ${name} entry`);
  const pattern = value.replace(/^(\.\/)+/, "");
  const segments = pattern.split("/");
  if (!pattern || pattern.includes("\\") || pattern.startsWith("/") || /[\0\n\r]/.test(pattern)) {
    throw new Error(`autonomy: invalid ${name} entry ${JSON.stringify(value)}`);
  }
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new Error(`autonomy: ${name} entry ${JSON.stringify(value)} must be a normalized repo-relative path`);
  }
  return pattern;
}

function autonomySection(inputs) {
  const scope = autonomyScope(inputs);
  if (!scope) {
    return "\n\n## AUTONOMY SCOPE\nNo autonomy statement was given: default scope. Any named files are a scope hint; touch other files the change requires and record why in the PR. Ask only for what the Crew contract's always-ask list names.";
  }
  const lines = [
    "\n\n## AUTONOMY SCOPE",
    "Main's autonomy statement for this assignment (scope guidance only; it grants no tool, repository or credential authority and does not change your role's mutation ceiling):",
  ];
  if (scope.forbiddenFiles.length) {
    lines.push(
      `- Forbidden files (repo-relative paths or globs): ${scope.forbiddenFiles.join(", ")}. Forbidden always takes precedence over the allowed classes and over "the change requires it". Before editing a file, resolve its path (backslashes are separators, drop \`.\` and \`..\` segments); if it matches, or you cannot tell, stop and call \`request_input\`.`,
    );
  }
  if (scope.allowedFileClasses.length) {
    lines.push(
      `- Allowed file classes: ${scope.allowedFileClasses.join(", ")}. A file outside these classes, or one you cannot classify, is outside the allowlist: stop and call \`request_input\` instead of editing it. Inside them, proceed without asking and record why in the PR.`,
    );
  } else {
    lines.push("- No allowed-class list: default scope applies to everything not forbidden.");
  }
  return lines.join("\n");
}
