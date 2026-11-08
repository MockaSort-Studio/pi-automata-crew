import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assignmentContext, fileChangeDecision } from "../../extensions/crew/crew/lib/assignment-context.mjs";
import { crewDisciplineModule } from "../../extensions/crew/crew/lib/automaton-body/lib/modules/crew-discipline.mjs";
import { createRequestInputTool } from "../../extensions/crew/runner/request-input-tool.mjs";

const autonomy = { kind: "autonomy", allowedFileClasses: ["tests", "docs", "source"], forbiddenFiles: [".github/**", "secrets/*"] };
const member = { inputs: [{ kind: "issue", number: 151 }, autonomy], acceptanceCriteria: ["Named files are a hint."] };

// Scripted worker: it reads only the assembled context, applies the contract decision to each file it
// must touch, and calls the real request_input tool exactly when the decision is "ask".
async function runScriptedWorker(member, changes) {
  const requests = [];
  const tool = createRequestInputTool({ onRequest: (r) => requests.push(r) });
  const assembled = assignmentContext(member);
  const inputs = JSON.parse(assembled.split("\n").find((line) => line.startsWith("{"))).inputs;
  const edited = [];
  for (const change of changes) {
    const decision = fileChangeDecision(inputs, change);
    if (decision.action === "ask") {
      await tool.execute("1", { question: decision.reason });
      break;
    }
    edited.push(change.path);
  }
  return { requests, edited, assembled };
}

test("an in-scope contradicting-test update does not invoke request_input", async () => {
  const { requests, edited } = await runScriptedWorker(member, [
    { path: "tests/crew/cached-ownership.test.mjs", fileClass: "tests" },
    { path: "docs/ownership.md", fileClass: "docs" },
  ]);
  assert.deepEqual(requests, []);
  assert.equal(edited.length, 2);
});

test("a named-files list alone is a scope hint: unnamed supporting files still proceed", () => {
  assert.equal(fileChangeDecision([], { path: "tests/other.test.mjs", fileClass: "tests" }).action, "proceed");
});

test("an explicitly forbidden path requires escalation through request_input", async () => {
  const { requests, edited } = await runScriptedWorker(member, [
    { path: "tests/a.test.mjs", fileClass: "tests" },
    { path: ".github/workflows/ci.yml", fileClass: "ci" },
    { path: "tests/never-reached.test.mjs", fileClass: "tests" },
  ]);
  assert.equal(requests.length, 1);
  assert.match(requests[0].question, /forbidden/);
  assert.deepEqual(edited, ["tests/a.test.mjs"]);
});

test("a file class outside the allowed classes requires escalation", () => {
  assert.equal(fileChangeDecision(member.inputs, { path: "deploy/x.tf", fileClass: "infrastructure" }).action, "ask");
});

test("the autonomy statement is scope only and is surfaced without granting authority", () => {
  const assembled = assignmentContext(member);
  assert.match(assembled, /grants no tool, repository or credential authority/);
  assert.doesNotMatch(assignmentContext({ inputs: [{ kind: "issue" }] }), /autonomy/);
});

test("the contract states the autonomy rule and the always-ask list", () => {
  const { instructions } = crewDisciplineModule();
  for (const text of ["contradict the issue", "scope hint", "equivalent implementation approaches", "new authority or credentials", "security or scope decision", "evidence you cannot obtain"]) {
    assert.ok(instructions.includes(text), text);
  }
});

test("the request_input tool separates authority questions from implementation questions, schema unchanged", () => {
  const tool = createRequestInputTool({ onRequest() {} });
  assert.match(tool.description, /authority/);
  assert.match(tool.description, /Do NOT use it for routine implementation choices/);
  assert.deepEqual(Object.keys(tool.parameters.properties), ["question"]);
});
