import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assemble } from "../../extensions/crew/crew/lib/assembly.mjs";
import { prepareCrew } from "../../extensions/crew/crew/lib/startup.mjs";
import { validateMemberAuthority } from "../../extensions/crew/crew/lib/member-authority.mjs";

const github = "collaboration/pi-github-tools";
const member = (role, tools) => ({ name: "snowball", role, tools });
const grants = (suite, ...operations) => [{ suite, operations }];

test("role and persona policy allows only authorized suite and system operations", () => {
  for (const role of ["lead", "architect", "advisor", "developer", "integrator", "reviewer"]) {
    assert.doesNotThrow(() => assemble("bollo", role, "", {}));
    if (role !== "lead")
      assert.throws(
        () => assemble("bollo", role, "", { tools: grants(github, "github_issue_create") }),
        /outside|unauthorized/i,
      );
  }
  assert.doesNotThrow(() => assemble("snowball", "developer", "", { tools: grants(github, "github_git_push") }));
  assert.doesNotThrow(() => assemble("bollo", "reviewer", "", { tools: grants(github, "github_pull_request_view") }));
  assert.throws(
    () => assemble("snowball", "advisor", "", { tools: grants("system", "write") }),
    /outside|unauthorized/i,
  );
  assert.throws(
    () => assemble("snowball", "developer", "", { tools: grants("unknown/suite", "github_issue_view") }),
    /outside|unauthorized|unknown/i,
  );
});

test("developer PR authority permits ownership operations but not review or merge", () => {
  const permitted = [
    "github_pull_requests_list",
    "github_pull_request_view",
    "github_pull_request_files",
    "github_pull_request_checks",
    "github_pull_request_review_threads",
    "github_pull_request_update",
    "github_pull_request_add_label",
    "github_pull_request_remove_label",
  ];
  const inhibited = [
    "github_pull_request_comment",
    "github_pull_request_review",
    "github_pull_request_review_start",
    "github_pull_request_review_inline_comment",
    "github_pull_request_review_submit",
    "github_pull_request_merge",
  ];
  for (const operation of permitted) {
    assert.doesNotThrow(() => validateMemberAuthority({ tools: [] }, "developer", grants(github, operation)));
  }
  for (const operation of inhibited) {
    assert.throws(
      () => validateMemberAuthority({ tools: [] }, "developer", grants(github, operation)),
      new RegExp(`Armory operation outside developer's capabilities: ${operation}`),
    );
  }
});

test("developer and integrator personas cannot grant review, comment, or merge authority", () => {
  const prohibited = [
    "github_pull_request_comment",
    "github_pull_request_review",
    "github_pull_request_review_start",
    "github_pull_request_review_inline_comment",
    "github_pull_request_review_submit",
    "github_pull_request_merge",
  ];
  const persona = { tools: [...prohibited, "github_pull_request_review_threads"] };
  for (const role of ["developer", "integrator"]) {
    const defaults = validateMemberAuthority(persona, role).suiteGrants[0].tools;
    for (const operation of prohibited) {
      assert.ok(!defaults.includes(operation));
      assert.throws(() => validateMemberAuthority(persona, role, grants(github, operation)), /outside/);
    }
    assert.ok(defaults.includes("github_pull_request_review_threads"));
  }
  for (const operation of prohibited.slice(2, 5)) {
    assert.doesNotThrow(() => validateMemberAuthority(persona, "reviewer", grants(github, operation)));
  }
});

test("persona capabilities union with role policy without widening other personas", () => {
  const domain = { tools: ["github_project_fields"] };
  assert.deepEqual(validateMemberAuthority(domain, "advisor", grants(github, "github_project_fields")), {
    tools: [],
    suiteGrants: [{ suite: github, tools: ["github_project_fields"] }],
  });
  assert.throws(
    () => validateMemberAuthority({ tools: [] }, "advisor", grants(github, "github_project_fields")),
    /outside/,
  );
  assert.throws(
    () => validateMemberAuthority({ tools: ["github_not_real"] }, "advisor", grants(github, "github_not_real")),
    /Unknown/,
  );
});

test("personas cannot add mutations but can add audited reads", () => {
  const persona = { tools: ["edit", "write", "bash", "github_issue_create", "github_project_fields"] };
  for (const role of ["advisor", "reviewer"]) {
    const defaults = validateMemberAuthority(persona, role);
    for (const tool of ["edit", "write"]) {
      assert.ok(!defaults.tools.includes(tool));
      assert.throws(() => validateMemberAuthority(persona, role, grants("system", tool)), /outside/);
    }
    assert.throws(() => validateMemberAuthority(persona, role, grants(github, "github_issue_create")), /outside/);
    assert.ok(!defaults.suiteGrants[0].tools.includes("github_issue_create"));
    assert.ok(defaults.suiteGrants[0].tools.includes("github_project_fields"));
  }
  assert.throws(() => validateMemberAuthority(persona, "advisor", grants("system", "bash")), /outside/);
});

test("checks wait is role-granted to implementation and review roles and can be a persona read", () => {
  const operation = "github_pull_request_checks_wait";
  for (const role of ["developer", "integrator", "reviewer"]) {
    assert.doesNotThrow(() => validateMemberAuthority({ tools: [] }, role, grants(github, operation)));
  }
  assert.throws(() => validateMemberAuthority({ tools: [] }, "advisor", grants(github, operation)), /outside/);
  assert.doesNotThrow(() => validateMemberAuthority({ tools: [operation] }, "advisor", grants(github, operation)));
});

test("lead defaults defer issue mutations and project operations", () => {
  const deferred = [
    "github_issue_create",
    "github_issue_update",
    "github_issue_comment",
    "github_issue_add_label",
    "github_issue_remove_label",
    "github_subissue_add",
    "github_dependency_add",
    "github_project_fields",
    "github_project_item_add",
    "github_project_item_find",
    "github_project_field_set",
  ];
  const defaults = validateMemberAuthority({ tools: ["github_project_fields"] }, "lead").suiteGrants[0].tools;
  for (const tool of deferred) assert.ok(!defaults.includes(tool), tool);
  assert.ok(defaults.includes("github_issue_view"));
});

test("assembly and prepareCrew reject identical invalid grants before writing launch files", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-authority-"));
  try {
    for (const tools of [
      grants("system", "write"),
      grants(github, "github_issue_create"),
      grants("unknown/suite", "github_issue_view"),
    ]) {
      let message;
      try {
        assemble("snowball", "advisor", "", { tools });
      } catch (error) {
        message = error.message;
      }
      assert.ok(message);
      await assert.rejects(
        prepareCrew({ getAllTools: () => [] }, { members: [member("advisor", tools)] }, { cwd }, ".pi"),
        (error) => error.message === message,
      );
    }
    assert.throws(() => readFileSync(join(cwd, ".pi/runtime/crew-launch")), /ENOENT/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("assembled authority equals launch config authority", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-authority-"));
  try {
    const tools = [...grants("system", "read", "edit"), ...grants(github, "github_git_push")];
    const actor = assemble("snowball", "developer", "", { tools });
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      { members: [member("developer", tools)] },
      { cwd },
      ".pi",
    );
    const launched = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8")).agents[0];
    assert.deepEqual(launched.tools, actor.tools);
    assert.deepEqual(launched.suiteGrants, actor.suiteGrants);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
