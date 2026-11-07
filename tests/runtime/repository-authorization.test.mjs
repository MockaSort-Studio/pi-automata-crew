import { strict as assert } from "node:assert";
import test from "node:test";
import {
  authorizeRepositoryOperation,
  repositoryAuthorization,
} from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";

const policy = repositoryAuthorization({
  repo: "MockaSort-Studio/pi-automata-crew",
  revision: "a".repeat(40),
  base: "main",
  branch: "crew/run/actor",
});
const { repo, revision, branch } = policy;
const allow = (operation, input) => assert.doesNotThrow(() => authorizeRepositoryOperation(operation, input, policy));
const deny = (operation, input, pattern = /outside the worker authorization/) =>
  assert.throws(() => authorizeRepositoryOperation(operation, input, policy), pattern);

test("pull request inputs are narrowly authorized", () => {
  const reads = [
    "github_pull_requests_list",
    "github_pull_request_view",
    "github_pull_request_files",
    "github_pull_request_checks",
    "github_pull_request_review_threads",
  ];
  const writes = ["github_pull_request_update", "github_pull_request_add_label", "github_pull_request_remove_label"];
  for (const operation of [...reads, ...writes]) {
    const input =
      operation === "github_pull_requests_list"
        ? { repo }
        : { repo, pullNumber: 42, ...(operation.endsWith("update") ? { title: "x" } : {}) };
    allow(operation, input);
    deny(operation, { ...input, repo: "other/repo" });
    deny(operation, { ...input, unexpected: true }, /does not accept/);
    assert.throws(() => authorizeRepositoryOperation(operation, input), /authorization is required/);
    if (operation !== "github_pull_requests_list") deny(operation, { ...input, pullNumber: 0 }, /pullNumber/);
  }
  deny("github_pull_request_update", { repo, pullNumber: 1, base: "main" }, /does not accept/);
  deny("github_pull_request_update", { repo, pullNumber: 1, state: "merged" }, /state/);
  deny("github_pull_request_update", { repo, pullNumber: 1 }, /requires/);
  deny("github_pull_requests_list", { repo, state: "bad" }, /state/);
  deny("github_pull_requests_list", { repo, limit: 101 }, /limit/);
});

test("typed Git workflow is authorized only for the worker's repo, revision and branch", () => {
  allow("github_workspace_checkout", { repo, revision, branch });
  allow("github_git_status", { repo });
  allow("github_git_diff", { repo, paths: ["src/a.mjs"] });
  allow("github_git_stage", { repo, paths: ["src/a.mjs", "docs/b.md"] });
  allow("github_git_commit", { repo, message: "Change a" });
  allow("github_git_push", { repo, branch });
  allow("github_pull_request_create", { repo, head: branch, base: "main", title: "t", draft: true });
});

test("typed Git operations deny other repositories, revisions, branches and bases", () => {
  deny("github_git_status", { repo: "other/repo" });
  deny("github_workspace_checkout", { repo, revision: "b".repeat(40), branch });
  deny("github_workspace_checkout", { repo, revision, branch: "main" });
  deny("github_git_push", { repo, branch: "main" });
  deny("github_git_push", { repo, branch: "crew/run/other" });
  deny("github_pull_request_create", { repo, head: "main", base: "main" });
  deny("github_pull_request_create", { repo, head: branch, base: "release" });
});

test("widened inputs are rejected before policy checks", () => {
  deny("github_git_push", { repo, branch, force: true }, /does not accept "force"/);
  deny("github_git_push", { repo, branch, refspec: "HEAD:main" }, /does not accept "refspec"/);
  deny("github_workspace_checkout", { repo, revision, branch, remote: "x" }, /does not accept "remote"/);
  deny("github_git_status", undefined, /input is required/);
  deny("github_git_commit", { repo, message: " " }, /requires a message/);
  deny("github_git_commit", { repo, message: "m", paths: ["a"] }, /does not accept "paths"/);
});

test("staged and diffed paths must be plain workspace-relative paths", () => {
  for (const path of ["/etc/passwd", "../outside", "a/../../b", ":(top)x", ":!secret", "--all", "a\nb", ""])
    deny("github_git_stage", { repo, paths: [path] }, /workspace-relative/);
  deny("github_git_diff", { repo, paths: "src" }, /workspace-relative/);
});

test("guarded operations fail closed without a policy", () => {
  for (const operation of ["github_git_push", "github_workspace_checkout", "github_pull_request_create"])
    assert.throws(() => authorizeRepositoryOperation(operation, { repo }), /authorization is required/);
  assert.doesNotThrow(() => authorizeRepositoryOperation("github_issue_view", { repo: "any/repo" }));
});

test("new read operations validate exact keys and bounded values", () => {
  const cases = [
    [
      "github_pull_request_checks_wait",
      { repo, pullNumber: 1, sha: "a".repeat(7), intervalSeconds: 5, failFast: false },
      {
        pullNumber: [0, 1.5],
        sha: ["a".repeat(6), "a".repeat(65), "g".repeat(7), 1234567],
        intervalSeconds: [4, 121, 5.5],
        failFast: ["true", 1],
      },
    ],
    ["github_workflow_runs_list", { repo, workflow: "ci.yml", limit: 1 }, { workflow: [1, null], limit: [0, 101, 1.5] }],
    ["github_workflow_run_view", { repo, runId: 1 }, { runId: [0, -1, 1.5, "1"] }],
    [
      "github_workflow_run_failed_log",
      { repo, runId: 1, maxChars: 1 },
      { runId: [0, 1.5], maxChars: [0, 12001, 1.5] },
    ],
  ];
  for (const [operation, input, invalid] of cases) {
    allow(operation, input);
    deny(operation, { ...input, repo: "other/repo" });
    deny(operation, { ...input, unknown: true }, /does not accept/);
    for (const [key, values] of Object.entries(invalid))
      for (const value of values) deny(operation, { ...input, [key]: value }, /.+/);
  }
  allow("github_pull_request_checks_wait", {
    repo,
    pullNumber: 1,
    sha: "F".repeat(64),
    intervalSeconds: 120,
    failFast: true,
  });
  allow("github_workflow_runs_list", { repo, limit: 100 });
  allow("github_workflow_run_failed_log", { repo, runId: 1, maxChars: 12000 });
  deny("github_pull_request_checks_wait", { repo }, /pullNumber/);
  deny("github_workflow_run_view", { repo }, /runId/);
  deny("github_workflow_run_failed_log", { repo }, /runId/);
});
