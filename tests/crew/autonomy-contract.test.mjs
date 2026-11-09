import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assemble } from "../../extensions/crew/crew/lib/assembly.mjs";
import { createRequestInputTool } from "../../extensions/crew/runner/request-input-tool.mjs";

// These tests prove what the real assembly delivers to a worker: the instructions text. They do not and
// cannot prove that a model obeys it, and nothing in the runtime enforces the autonomy statement.
const statement = {
  kind: "autonomy",
  allowedFileClasses: ["tests", "docs"],
  forbiddenFiles: [".github/**", "secrets/*"],
};
const assembleWith = (inputs, role = "developer") =>
  assemble("snowball", role, "Fix the cached lookup.", { inputs, deliverTo: "main" });

test("assembled developer instructions carry the autonomy rule and the always-ask list", () => {
  const { instructions } = assembleWith([{ kind: "issue", number: 151 }]);
  for (const text of [
    "contradict the issue",
    "scope hint",
    "equivalent implementation approaches",
    "new authority or credentials",
    "security or scope decision",
    "evidence you cannot obtain",
    "Named files are a scope hint",
  ]) {
    assert.ok(instructions.includes(text), text);
  }
  assert.doesNotMatch(instructions, /Edit only the files the assignment names/);
});

test("without a statement the assembled instructions say default scope applies", () => {
  const { instructions } = assembleWith([{ kind: "issue", number: 151 }]);
  assert.match(instructions, /## AUTONOMY SCOPE\nNo autonomy statement was given: default scope/);
  assert.doesNotMatch(instructions, /Forbidden files/);
});

test("the statement is explained in the assembled instructions, not only passed as JSON", () => {
  const { instructions } = assembleWith([{ kind: "issue", number: 151 }, statement]);
  const section = instructions.slice(instructions.indexOf("## AUTONOMY SCOPE"));
  assert.match(section, /Forbidden files .*: \.github\/\*\*, secrets\/\*/);
  assert.match(section, /Forbidden always takes precedence/);
  assert.match(section, /Allowed file classes: tests, docs\. A file outside these classes, or one you cannot classify/);
  assert.match(section, /stop and call `request_input`/);
  assert.match(section, /grants no tool, repository or credential authority/);
  const without = assembleWith([{ kind: "issue", number: 151 }]).instructions;
  assert.ok(!without.includes("Forbidden files"), "no statement, no forbidden-file policy");
  assert.doesNotMatch(section, /No autonomy statement was given/);
});

test("the statement does not change the role's tools or authority", () => {
  for (const role of ["developer", "reviewer"]) {
    const base = assembleWith([{ kind: "issue", number: 151 }], role);
    const scoped = assembleWith([statement], role);
    assert.deepEqual(scoped.tools, base.tools);
    assert.deepEqual(scoped.extensionPaths, base.extensionPaths);
  }
});

test("malformed or ambiguous statements are rejected at assembly, never silently widened", () => {
  const bad = [
    { kind: "autonomy" },
    { kind: "autonomy", allowedFileClasses: [] },
    { kind: "autonomy", allowedFileClasses: "tests" },
    { kind: "autonomy", allowedFileClasses: ["tests", 7] },
    { kind: "autonomy", allowedFileClasses: ["Tests Dir"] },
    { kind: "autonomy", forbiddenFiles: [] },
    { kind: "autonomy", forbiddenFiles: ["ok", ""] },
    { kind: "autonomy", forbiddenFiles: [null] },
    { kind: "autonomy", forbiddenFiles: ["tests/../.github/ci.yml"] },
    { kind: "autonomy", forbiddenFiles: [".github\\ci.yml"] },
    { kind: "autonomy", forbiddenFiles: ["/etc/passwd"] },
    { kind: "autonomy", forbiddenFiles: ["a//b"] },
    { kind: "autonomy", forbiddenFiles: ["a/./b"] },
    { kind: "autonomy", allowedFileClasses: ["tests"], forbiddenFileClasses: ["ci"] },
    { kind: "autonomy", forbiddenFiles: ["a"], extra: true },
    { kind: "Autonomy", forbiddenFiles: ["a"] },
    { kind: " AUTONOMY ", allowedFileClasses: ["tests"] },
    { kind: "autonomy", forbiddenFiles: ["src/`x`"] },
    { kind: "autonomy", forbiddenFiles: ["a\u0007b"] },
    { kind: "autonomy", forbiddenFiles: ["a\tb"] },
  ];
  for (const input of bad) assert.throws(() => assembleWith([input]), /autonomy/, JSON.stringify(input));
  assert.throws(() => assembleWith([statement, statement]), /ambiguous/);
});

test("valid statements are normalized and deduplicated; forbidden-only and allowed-only are accepted", () => {
  const dup = assembleWith([{ kind: "autonomy", forbiddenFiles: ["./.github/**", ".github/**"] }]).instructions;
  assert.match(dup, /Forbidden files \(repo-relative paths or globs\): \.github\/\*\*\. Forbidden/);
  assert.match(dup, /No allowed-class list/);
  const allowed = assembleWith([{ kind: "autonomy", allowedFileClasses: ["tests", "tests"] }]).instructions;
  assert.match(allowed, /Allowed file classes: tests\. /);
  assert.doesNotMatch(allowed, /Forbidden files/);
});

test("the instructions escalate on traversal paths instead of dropping `..` segments", () => {
  const { instructions } = assembleWith([statement]);
  assert.match(instructions, /with backslashes as separators/);
  assert.match(instructions, /contains a `\.\.` segment \(for example `tests\/\.\.\/\.github\/ci\.yml`/);
  assert.match(instructions, /which is really `\.github\/ci\.yml`\) or you cannot be certain/);
  assert.match(instructions, /do not guess: stop and call `request_input`/);
  assert.doesNotMatch(instructions, /drop `\.` and `\.\.` segments/);
});

test("with no optional context at all, the base prompts still carry the default named-files guidance", () => {
  const { instructions } = assemble("snowball", "developer", "Fix the cached lookup.");
  assert.doesNotMatch(instructions, /## ASSIGNMENT CONTEXT/);
  assert.doesNotMatch(instructions, /## AUTONOMY SCOPE/);
  assert.match(instructions, /Named files are a scope hint/);
  assert.match(instructions, /Stop and ask only for files or classes the assignment forbids/);
  assert.match(instructions, /### Autonomy and escalation/);
});

test("no role is told to mutate or load skills against its role: read-only reviewers, no skills for workers", () => {
  for (const role of ["developer", "reviewer"]) {
    const { instructions } = assembleWith([{ kind: "issue", number: 151 }], role);
    assert.match(instructions, /Do not search for or load project skills/);
    assert.doesNotMatch(instructions, /post-iteration-review/);
    assert.doesNotMatch(instructions, /HALL_SKIP_GONDOLIN_LIVE_TESTS|github-armory-routing|github-pull-reviews/);
  }
  const { instructions } = assembleWith([{ kind: "issue", number: 151 }], "reviewer");
  assert.match(instructions, /If your role may change files and you were granted repository operations/);
  assert.match(instructions, /A read-only role never edits, commits or pushes/);
  assert.doesNotMatch(instructions, /When you have repository tools, check out/);
});

test("the request_input tool separates authority questions from implementation questions, schema unchanged", () => {
  const tool = createRequestInputTool({ onRequest() {} });
  assert.match(tool.description, /authority/);
  assert.match(tool.description, /Do NOT use it for routine implementation choices/);
  assert.deepEqual(Object.keys(tool.parameters.properties), ["question"]);
});
