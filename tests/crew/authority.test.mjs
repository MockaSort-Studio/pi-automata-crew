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

test("persona capabilities union with role policy without widening other personas", () => {
  const domain = { tools: ["edit", "github_pull_request_view"] };
  assert.deepEqual(
    validateMemberAuthority(domain, "advisor", [
      ...grants("system", "edit"),
      ...grants(github, "github_pull_request_view"),
    ]),
    {
      tools: ["edit"],
      suiteGrants: [{ suite: github, tools: ["github_pull_request_view"] }],
    },
  );
  assert.throws(
    () => validateMemberAuthority({ tools: [] }, "advisor", grants(github, "github_pull_request_view")),
    /outside/,
  );
  assert.throws(
    () => validateMemberAuthority({ tools: ["github_not_real"] }, "advisor", grants(github, "github_not_real")),
    /Unknown/,
  );
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
