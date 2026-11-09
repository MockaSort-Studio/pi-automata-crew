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

const authorize = (operation, input) => () => authorizeRepositoryOperation(operation, input, policy);

test("released optional workflow inputs are accepted within Crew's bounds", () => {
  for (const input of [{ artifacts: true }, { artifacts: false }])
    assert.doesNotThrow(authorize("github_workflow_run_view", { repo, runId: 1, ...input }), JSON.stringify(input));
  for (const input of [
    { jobId: 9007199254740991, step: 1000, firstFailure: true },
    { firstFailure: false, startLine: 1, maxLines: 2000, startChar: 0 },
    { startChar: 4194304, maxChars: 1 },
    { artifactId: 7, artifactPath: "reports/junit.xml" },
    { artifactName: "n".repeat(256), artifactPath: "a".repeat(1024) },
    { artifactName: "test-logs", artifactPath: "dir.with.dots/..hidden/file..txt" },
  ])
    assert.doesNotThrow(
      authorize("github_workflow_run_failed_log", { repo, runId: 1, ...input }),
      JSON.stringify(input),
    );
});

test("malformed optional workflow inputs are refused before reaching Armory", () => {
  for (const artifacts of ["true", 1, null])
    assert.throws(authorize("github_workflow_run_view", { repo, runId: 1, artifacts }), /Invalid artifacts/);
  const invalid = {
    jobId: [0, -1, 1.5, "7", 2 ** 53, null],
    step: [0, -1, 1001, 1.5, "1"],
    startLine: [0, -3, 0.5, 2 ** 53, "1"],
    maxLines: [0, 2001, 1e9, 1.5],
    startChar: [-1, 4194305, 0.5, "0", 2 ** 53],
    maxChars: [0, 12001, 1e20, 1.5],
    artifactId: [0, -1, 1.5, "1", 2 ** 53],
    firstFailure: ["true", 1, 0, null],
    artifactName: ["", "n".repeat(257), 1, null, ["a"]],
    artifactPath: [
      "",
      "a".repeat(1025),
      "/etc/passwd",
      "../outside",
      "a/../../b",
      "a/./b",
      "./a",
      "a//b",
      "a/",
      "..",
      "C:/x",
      "c:x",
      "a\\b",
      "\\\\server\\share",
      "a\nb",
      "a\0b",
      "a\x7fb",
      7,
      null,
      ["a"],
    ],
  };
  for (const [key, values] of Object.entries(invalid))
    for (const value of values)
      assert.throws(
        authorize("github_workflow_run_failed_log", { repo, runId: 1, [key]: value }),
        new RegExp(`Invalid ${key}`),
        `${key}=${JSON.stringify(value)}`,
      );
  // Unknown keys and the other operation's optional input stay refused; the repo binding still applies.
  assert.throws(authorize("github_workflow_run_failed_log", { repo, runId: 1, artifacts: true }), /does not accept/);
  assert.throws(authorize("github_workflow_run_view", { repo, runId: 1, jobId: 1 }), /does not accept/);
  assert.throws(authorize("github_workflow_run_failed_log", { repo, runId: 1, url: "https://x" }), /does not accept/);
  assert.throws(
    authorize("github_workflow_run_failed_log", { repo: "other/repo", runId: 1, artifactId: 1 }),
    /outside the worker authorization/,
  );
  assert.throws(
    authorize("github_workflow_run_view", { repo: "other/repo", runId: 1, artifacts: true }),
    /outside the worker authorization/,
  );
});
