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
  assert.doesNotMatch(section, /No autonomy statement was given/);
});

test("removing the statement removes the policy: the section differs from the one with a statement", () => {
  const withStatement = assembleWith([statement]).instructions;
  const without = assembleWith([{ kind: "issue", number: 151 }]).instructions;
  assert.ok(withStatement.includes("Forbidden files"));
  assert.ok(!without.includes("Forbidden files"));
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

test("the instructions tell the worker how to treat traversal and backslash paths", () => {
  const { instructions } = assembleWith([statement]);
  assert.match(instructions, /backslashes are separators, drop `\.` and `\.\.` segments/);
  assert.match(instructions, /if it matches, or you cannot tell, stop and call `request_input`/);
});

test("the request_input tool separates authority questions from implementation questions, schema unchanged", () => {
  const tool = createRequestInputTool({ onRequest() {} });
  assert.match(tool.description, /authority/);
  assert.match(tool.description, /Do NOT use it for routine implementation choices/);
  assert.deepEqual(Object.keys(tool.parameters.properties), ["question"]);
});
