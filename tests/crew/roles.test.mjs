import { strict as assert } from "node:assert";
import { test } from "node:test";
import { roleModule } from "../../extensions/crew/crew/lib/automaton-body/lib/modules/role.mjs";
import { assemble } from "../../extensions/crew/crew/lib/assembly.mjs";
import { GITHUB_BASE_TOOLS } from "../../extensions/crew/crew/lib/github-base-tools.mjs";

test("roles provide bounded native capabilities", () => {
  for (const [role, tool, thinking] of [
    ["lead", undefined, "medium"],
    ["architect", "read", "high"],
    ["advisor", "read", "low"],
    ["developer", "edit", "medium"],
    ["integrator", "edit", "low"],
    ["reviewer", "bash", "medium"],
  ]) {
    const result = roleModule({ role, override: {} });
    assert.match(result.instructions, /RESPONSIBILITIES/);
    if (tool) assert.ok(result.tools.includes(tool));
    assert.equal(result.thinking, thinking);
  }
});

test("GitHub base catalog declares bounded workflow inspection operations", () => {
  for (const operation of ["github_workflow_runs_list", "github_workflow_run_view", "github_workflow_run_failed_log"])
    assert.ok(GITHUB_BASE_TOOLS.includes(operation));
});

test("base Crew policy has Comm and no implicit GitHub operations", () => {
  const lead = roleModule({ role: "lead", override: {} });
  const architect = assemble("tomashco", "architect", "");
  assert.match(lead.instructions, /comm_request/);
  assert.match(lead.instructions, /comm_notify/);
  assert.doesNotMatch(lead.instructions, /crew_kickoff|github_discussion/);
  assert.match(architect.instructions, /SDK Comm is the Crew coordination channel/);
  assert.doesNotMatch(architect.instructions, /github_discussion|crew_ask|Discussion is the durable/);
  assert.ok(!lead.tools.some((tool) => tool.startsWith("github_")));
  assert.ok(!architect.tools.some((tool) => tool.startsWith("github_workflow_")));
  assert.ok(!architect.tools.some((tool) => tool.startsWith("github_")));
  assert.ok(!architect.tools.some((tool) => tool.startsWith("crew_")));
});

test("integrator has bounded reconciliation authority", () => {
  const result = roleModule({ role: "integrator", override: {} });
  for (const tool of ["read", "edit", "write", "bash"]) assert.ok(result.tools.includes(tool));
  assert.match(result.instructions, /not a Lead/);
});

test("reviewer has review-only authority", () => {
  const result = assemble("snowball", "reviewer", "", {
    systemOperations: ["read", "grep", "find", "ls", "bash"],
  });
  for (const tool of ["read", "grep", "find", "ls", "bash"]) assert.ok(result.tools.includes(tool));
  for (const tool of ["edit", "write"]) assert.ok(!result.tools.includes(tool));
  assert.match(result.instructions, /REQUEST_CHANGES/);
});

test("Bollo can perform a read-only security review with no implicit suite grants", () => {
  const result = assemble("bollo", "reviewer", "Review the worker network boundary.", {
    systemOperations: ["read", "grep", "find", "ls", "bash"],
  });
  assert.match(result.instructions, /Bollo treats every permission/);
  assert.match(result.instructions, /security-boundary-review/);
  assert.ok(!result.tools.some((tool) => tool.startsWith("github_")));
  assert.ok(!result.tools.includes("edit"));
  assert.ok(!result.tools.includes("write"));
});

test("rejects an assignment operation outside a role's capabilities", () =>
  assert.throws(() => assemble("snowball", "advisor", "", { systemOperations: ["edit"] }), /outside/));

test("the developer prompt carries the Crew working rules and no stale Lead or Discussion wording", () => {
  const { instructions } = roleModule({ role: "developer", override: {} });
  assert.match(instructions, /private guest workspace/);
  assert.match(instructions, /no local Git checkout/);
  assert.match(instructions, /authorized branch and PR URL/);
  assert.doesNotMatch(instructions, /Lead|Discussion/);
});

test("developer has bounded implementation authority", () => {
  const result = roleModule({ role: "developer", override: {} });
  for (const tool of ["read", "edit", "write", "bash"]) assert.ok(result.tools.includes(tool));
  assert.match(result.instructions, /Plan before editing/);
});
test("unknown roles fail", () => assert.throws(() => roleModule({ role: "wizard", override: {} }), /not defined/));

test("only the lead role is granted the party-wide broadcast tool", () => {
  for (const role of ["architect", "advisor", "developer", "integrator", "reviewer"]) {
    const result = roleModule({ role, override: {} });
    assert.ok(!result.commTools.includes("comm_notify_all"), `${role} must not have comm_notify_all`);
    assert.ok(!result.commTools.includes("comm_notify_many"), `${role} must not have comm_notify_many`);
    assert.deepEqual(result.commTools, ["comm_notify", "comm_request", "comm_reply"]);
  }
  const lead = roleModule({ role: "lead", override: {} });
  assert.ok(lead.commTools.includes("comm_notify_all"));
  assert.ok(lead.commTools.includes("crew_assign"), "the Lead hands out the plan with crew_assign");
});
