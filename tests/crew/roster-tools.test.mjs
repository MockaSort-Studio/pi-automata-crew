import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assemble } from "../../extensions/crew/crew/lib/assembly.mjs";
import { validateMemberAuthority } from "../../extensions/crew/crew/lib/member-authority.mjs";
import { AUTOMATA } from "../../extensions/crew/crew/lib/roster.mjs";
import { authorizeRepositoryOperation } from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";

const github = "collaboration/pi-github-tools";
const expected = {
  "old-major": ["github_issues_list", "github_subissues_list", "github_dependency_list"],
  mergio: [
    "github_workflow_runs_list",
    "github_workflow_run_view",
    "github_workflow_run_failed_log",
    "github_pull_request_checks",
  ],
  bollo: [
    "github_workflow_runs_list",
    "github_workflow_run_view",
    "github_workflow_run_failed_log",
    "github_pull_request_view",
    "github_pull_request_files",
    "github_issues_list",
  ],
  tomashco: ["github_issues_list", "github_discussions_list", "github_discussion_view", "github_discussion_comments"],
  "indiana-docs": ["github_issues_list", "github_discussions_list", "github_discussion_view"],
  snowball: ["github_issues_list"],
  hamlet: ["github_workflow_runs_list", "github_workflow_run_view"],
  pyrate: [],
  frontenzo: [],
  aeeeiii: [],
  panoramix: [],
};
const readOnly = new Set([
  "github_discussion_comments",
  "github_discussion_view",
  "github_discussions_list",
  "github_issue_view",
  "github_subissues_list",
  "github_issues_list",
  "github_dependency_list",
  "github_label_list",
  "github_project_fields",
  "github_project_item_find",
  "github_pull_requests_list",
  "github_pull_request_view",
  "github_pull_request_files",
  "github_pull_request_checks",
  "github_pull_request_checks_wait",
  "github_pull_request_review_threads",
  "github_workflow_runs_list",
  "github_workflow_run_view",
  "github_workflow_run_failed_log",
]);
const grants = (operations) => [{ suite: github, operations }];

test("personas declare exactly their read-only recognized domain tools", () => {
  assert.deepEqual(Object.keys(AUTOMATA).sort(), Object.keys(expected).sort());
  for (const [name, tools] of Object.entries(expected)) {
    assert.deepEqual(AUTOMATA[name].tools, tools, name);
    for (const tool of tools) {
      assert.ok(readOnly.has(tool), `${name}: ${tool} is not read-only`);
      assert.doesNotThrow(() => validateMemberAuthority(AUTOMATA[name], "advisor", grants([tool])));
    }
  }
});

test("unaudited project and checks-wait operations are withheld from persona grants", () => {
  for (const [name, automaton] of Object.entries(AUTOMATA)) {
    for (const tool of ["github_project_fields", "github_project_item_find", "github_pull_request_checks_wait"])
      assert.ok(!automaton.tools.includes(tool), `${name}: ${tool}`);
  }
});

test("persona PR reads reject cross-repository calls and missing authorization", () => {
  const policy = { repo: "owner/repo", revision: "a".repeat(40), base: "main", branch: "crew/test" };
  for (const operation of ["github_pull_request_view", "github_pull_request_files", "github_pull_request_checks"]) {
    const input = { repo: policy.repo, pullNumber: 1 };
    assert.doesNotThrow(() => authorizeRepositoryOperation(operation, input, policy));
    assert.throws(() => authorizeRepositoryOperation(operation, { ...input, repo: "other/repo" }, policy), /outside/);
    assert.throws(() => authorizeRepositoryOperation(operation, input), /authorization is required/);
  }
});

test("only specialist personas render domain discipline", () => {
  for (const name of ["bollo", "mergio", "indiana-docs"]) {
    assert.equal(typeof AUTOMATA[name].discipline, "string");
    const instructions = assemble(name, "advisor", "").instructions;
    assert.ok(instructions.includes(`## DOMAIN DISCIPLINE\n${AUTOMATA[name].discipline}`));
  }
  for (const name of Object.keys(expected).filter((name) => !["bollo", "mergio", "indiana-docs"].includes(name))) {
    assert.equal(AUTOMATA[name].discipline, undefined);
    assert.doesNotMatch(assemble(name, "advisor", "").instructions, /## DOMAIN DISCIPLINE/);
  }
});

test("bollo domain tools union with reviewer authority and advisor stays read-only", () => {
  const roles = JSON.parse(
    readFileSync(new URL("../../extensions/crew/crew/prompts/roles.json", import.meta.url), "utf8"),
  );
  const reviewer = roles.reviewer.tools.filter((tool) => tool.startsWith("github_"));
  const union = [...new Set([...reviewer, ...AUTOMATA.bollo.tools])];
  assert.deepEqual(validateMemberAuthority(AUTOMATA.bollo, "reviewer", grants(union)).suiteGrants, [
    { suite: github, tools: union },
  ]);
  assert.deepEqual(validateMemberAuthority(AUTOMATA.bollo, "advisor", grants(AUTOMATA.bollo.tools)).suiteGrants, [
    { suite: github, tools: AUTOMATA.bollo.tools },
  ]);
  assert.throws(
    () => validateMemberAuthority(AUTOMATA.bollo, "advisor", grants(["github_pull_request_review_submit"])),
    /outside/,
  );
});
