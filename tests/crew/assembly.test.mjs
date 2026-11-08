import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assemble } from "../../extensions/crew/crew/lib/assembly.mjs";
test("assembly rejects skill injection", () => {
  assert.throws(() => assemble("snowball", "developer", "", { skills: ["probe"] }), /skills.*not supported/i);
  assert.doesNotMatch(assemble("snowball", "developer", "").instructions, /## REQUIRED SKILLS/);
});
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

test("structured requirements assert grants without widening them", () => {
  const requiredCapabilities = [{ suite: "system", operations: ["edit", "bash"] }];
  assert.throws(() => assemble("snowball", "developer", "", { tools: [{ suite: "system", operations: ["read"] }], requiredCapabilities }), /developer-snowball.*system.*edit.*missing grant/i);
  assert.throws(() => assemble("snowball", "developer", "", { requiredCapabilities: [{ suite: "system", operations: ["teleport"] }] }), /system.*teleport.*unsupported/i);
  assert.throws(() => assemble("snowball", "developer", "", { requiredCapabilities: [{ suite: "collaboration/pi-github-tools", operations: ["github_pull_request_merge"] }] }), /github_pull_request_merge.*role.ceiling/i);
  const actor = assemble("snowball", "developer", "", { tools: [{ suite: "system", operations: ["edit", "bash"] }], requiredCapabilities });
  assert.deepEqual(actor.requiredCapabilities, requiredCapabilities);
  assert.deepEqual(actor.tools, ["edit", "bash"]);
});

test("evidence and PR assertions distinguish missing grants from unsupported operations", () => {
  const suite = "collaboration/pi-github-tools";
  for (const [role, op] of [["reviewer", "github_issue_view"], ["developer", "github_pull_request_create"], ["developer", "github_git_push"]]) {
    assert.throws(() => assemble("snowball", role, "", { tools: [], requiredCapabilities: [{ suite, operations: [op] }] }), new RegExp(`${role}-snowball.*${op}.*missing grant`));
  }
  assert.throws(() => assemble("snowball", "developer", "", { requiredCapabilities: [{ suite, operations: ["github_not_real"] }] }), /github_not_real.*unsupported/);
  assert.throws(() => assemble("snowball", "developer", "", { requiredCapabilities: [{ suite: "unknown", operations: ["x"] }] }), /unknown.*x.*unsupported/);
  assert.throws(() => assemble("snowball", "developer", "", { requiredCapabilities: "read" }), /requiredCapabilities must be an array/);
});

test("assembly rejects oversized work", () =>
  assert.throws(() => assemble("mergio", "architect", "x".repeat(4001)), /exceeds 4000/));
