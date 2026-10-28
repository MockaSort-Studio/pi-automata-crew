import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assemble } from "../../.pi/extensions/hall-crew/crew/lib/assembly.mjs";
test("assembly narrows explicit system operations", () => {
  const actor = assemble("mergio", "architect", "Design one focused behavior and prove it.", {
    systemOperations: ["read"],
  });
  assert.match(actor.instructions, /## BOUNDED ASSIGNMENT/);
  assert.ok(!actor.tools.some((tool) => tool.startsWith("crew_")));
  assert.deepEqual(actor.tools, ["read"]);
});
test("reviewer uses only GitHub tools supplied by the runtime", () => {
  const tools = [
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "github_pull_request_view",
    "github_pull_request_files",
    "github_pull_request_checks",
    "github_pull_request_review_threads",
    "github_pull_request_review_start",
    "github_pull_request_review_inline_comment",
    "github_pull_request_review_submit",
    "github_pull_request_comment",
  ];
  const actor = assemble("snowball", "reviewer", "Review PR 1.", {
    runtimeTools: tools,
    systemOperations: tools.filter((tool) => !tool.startsWith("github_")),
  });
  assert.deepEqual(actor.extensionPaths, []);
});

test("assembly does not claim unverified Armory tools", () => {
  const actor = assemble("panoramix", "developer", "Implement one BEAM change.");
  assert.ok(!actor.tools.includes("mix_test"));
});
test("assembly adds only supplied common assignment context", () => {
  const actor = assemble("snowball", "developer", "Review a change.", {
    deliverTo: "main",
    authority: { merge: false },
  });
  assert.match(actor.instructions, /## ASSIGNMENT CONTEXT/);
  assert.match(actor.instructions, /"deliverTo":"main"/);
});

test("assembly rejects oversized work", () =>
  assert.throws(() => assemble("mergio", "architect", "x".repeat(4001)), /exceeds 4000/));
