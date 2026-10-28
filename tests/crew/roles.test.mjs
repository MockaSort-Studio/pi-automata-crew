import { strict as assert } from "node:assert";
import { test } from "node:test";
import { roleModule } from "../../.pi/extensions/hall-crew/crew/lib/automaton-body/lib/modules/role.mjs";
import { assemble } from "../../.pi/extensions/hall-crew/crew/lib/assembly.mjs";

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

test("base Crew policy has Comm and no implicit GitHub operations", () => {
  const lead = roleModule({ role: "lead", override: {} });
  const architect = assemble("tomashco", "architect", "");
  assert.match(lead.instructions, /comm_request/);
  assert.match(lead.instructions, /comm_notify/);
  assert.doesNotMatch(lead.instructions, /crew_kickoff|github_discussion/);
  assert.match(architect.instructions, /SDK Comm is the Crew coordination channel/);
  assert.doesNotMatch(architect.instructions, /github_discussion|crew_ask|Discussion is the durable/);
  assert.ok(!lead.tools.some((tool) => tool.startsWith("github_")));
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
  for (const tool of ["read", "grep", "find", "ls", "bash"])
    assert.ok(result.tools.includes(tool));
  for (const tool of ["edit", "write"]) assert.ok(!result.tools.includes(tool));
  assert.match(result.instructions, /REQUEST_CHANGES/);
});

test("rejects an assignment operation outside a role's capabilities", () =>
  assert.throws(() => assemble("snowball", "advisor", "", { systemOperations: ["edit"] }), /outside/));

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
