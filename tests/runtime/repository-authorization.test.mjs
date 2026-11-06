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

test("typed Git workflow is authorized only for the worker's repo, revision and branch", () => {
  allow("github_workspace_checkout", { repo, revision, branch });
  allow("github_git_status", { repo });
  allow("github_git_diff", { repo, paths: ["src/a.mjs"] });
  allow("github_git_stage", { repo, paths: ["src/a.mjs", "docs/b.md"] });
  allow("github_git_commit", { repo, message: "Change a" });
  allow("github_git_push", { repo, branch });
  allow("github_pull_request_create", { repo, head: branch, base: "main", title: "t", draft: true });
  allow("github_workspace_snapshot", { repo, revision });
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
