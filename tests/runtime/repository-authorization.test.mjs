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

test("repository policy accepts only one generic snapshot, branch, and PR projection", () => {
  assert.doesNotThrow(() =>
    authorizeRepositoryOperation("github_workspace_snapshot", { repo: policy.repo, revision: policy.revision }, policy),
  );
  assert.doesNotThrow(() =>
    authorizeRepositoryOperation(
      "github_ref_create",
      { repo: policy.repo, branch: policy.branch, sha: policy.revision },
      policy,
    ),
  );
  assert.doesNotThrow(() =>
    authorizeRepositoryOperation("github_file_update", { repo: policy.repo, branch: policy.branch }, policy),
  );
  assert.doesNotThrow(() =>
    authorizeRepositoryOperation(
      "github_pull_request_create",
      { repo: policy.repo, head: policy.branch, base: "main" },
      policy,
    ),
  );
});

test("repository policy fails closed for absent or broader model inputs", () => {
  assert.throws(
    () => authorizeRepositoryOperation("github_workspace_snapshot", { repo: policy.repo, revision: policy.revision }),
    /authorization is required/,
  );
  assert.throws(
    () =>
      authorizeRepositoryOperation(
        "github_ref_create",
        { repo: "other/repo", branch: policy.branch, sha: policy.revision },
        policy,
      ),
    /outside the worker authorization/,
  );
  assert.throws(
    () => authorizeRepositoryOperation("github_file_update", { repo: policy.repo, branch: "main" }, policy),
    /outside the worker authorization/,
  );
});
