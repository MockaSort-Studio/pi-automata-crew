import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeRepositoryOperation,
  repositoryAuthorization,
} from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";

const repo = "owner/repo";
const policy = repositoryAuthorization({ repo, revision: "a".repeat(40), base: "main", branch: "crew/test" });

test("workflow reads require the authorized repository and bounded input", () => {
  for (const [operation, input] of [
    ["github_workflow_runs_list", { repo, workflow: "ci.yml", limit: 10 }],
    ["github_workflow_run_view", { repo, runId: 123 }],
    ["github_workflow_run_failed_log", { repo, runId: 123, maxChars: 12000 }],
  ]) {
    assert.doesNotThrow(() => authorizeRepositoryOperation(operation, input, policy));
    assert.throws(() => authorizeRepositoryOperation(operation, { ...input, repo: "other/repo" }, policy));
    assert.throws(() => authorizeRepositoryOperation(operation, input));
    assert.throws(() => authorizeRepositoryOperation(operation, { ...input, extra: true }, policy));
  }
  for (const operation of ["github_workflow_run_view", "github_workflow_run_failed_log"]) {
    for (const runId of [0, -1, 1.5, "123", undefined])
      assert.throws(() => authorizeRepositoryOperation(operation, { repo, runId }, policy));
  }
});
