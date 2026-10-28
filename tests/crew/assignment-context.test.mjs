import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assignmentContext } from "../../.pi/extensions/hall-crew/crew/lib/assignment-context.mjs";

test("assignment context is omitted when no optional common fields are supplied", () => {
  assert.equal(assignmentContext({}), "");
});

test("assignment context carries generic inputs, delivery, authority, and criteria", () => {
  const context = assignmentContext({
    inputs: [{ kind: "pull_request", repo: "acme/repo", number: 7 }],
    deliverTo: "integrator-mergio-00",
    authority: { review: "submit", merge: false },
    acceptanceCriteria: ["No blocking regression."],
  });
  assert.match(context, /## ASSIGNMENT CONTEXT/);
  assert.match(context, /integrator-mergio-00/);
  assert.match(context, /pull_request/);
  assert.doesNotMatch(context, /reviewer/);
});
