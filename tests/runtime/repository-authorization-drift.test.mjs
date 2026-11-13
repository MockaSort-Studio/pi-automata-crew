import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizeRepositoryOperation,
  repositoryAuthorization,
} from "../../extensions/crew/env-runtime/lib/repository-authorization.mjs";

// Drift guard: the fixture is regenerated from the released Armory catalog. When a release adds an
// input to a guarded operation, Crew's authorization must either accept it (with bounds) or refuse it
// on purpose, listed here. A silent shape refusal blocks every call that uses the new input.
const snapshot = JSON.parse(readFileSync(new URL("../fixtures/armory-operations.json", import.meta.url), "utf8"));
const intentionallyRefused = {
  // A worker may not retarget its own pull request to another base.
  github_pull_request_update: ["base"],
};

const policy = repositoryAuthorization({
  repo: "owner/repo",
  revision: "a".repeat(40),
  base: "main",
  branch: "crew/run/actor",
});
const probeValue = { string: "x", integer: 1, boolean: true, array: ["x"] };
const shapeRefusal = (operation, input) => {
  try {
    authorizeRepositoryOperation(operation, input, policy);
  } catch (error) {
    return /does not accept "/.test(error.message) ? error.message : undefined;
  }
  return undefined;
};
// Guarded operations are discovered through the real authorize path: they reject an unknown key by shape.
const guarded = Object.keys(snapshot.operations).filter((operation) =>
  shapeRefusal(operation, { repo: policy.repo, __drift_probe__: 1 }),
);

test("drift probe discovers the guarded operations", () => {
  for (const operation of [
    "github_git_push",
    "github_pull_request_update",
    "github_workflow_runs_list",
    "github_workflow_run_view",
    "github_workflow_run_failed_log",
  ])
    assert.ok(guarded.includes(operation), operation);
});

test("every released input of a guarded operation is allowed or explicitly refused", () => {
  const unhandled = [];
  for (const operation of guarded) {
    const refused = intentionallyRefused[operation] ?? [];
    for (const [field, type] of Object.entries(snapshot.operations[operation].fields)) {
      if (field === "repo") continue;
      const value = probeValue[type] ?? "x";
      const refusal = shapeRefusal(operation, { repo: policy.repo, [field]: value });
      if (refused.includes(field)) assert.ok(refusal, `${operation}.${field} is listed as refused but is accepted`);
      else if (refusal) unhandled.push(`${operation}.${field}`);
    }
  }
  assert.deepEqual(unhandled, [], "released inputs refused by shape without an explicit decision");
});

test("intentional refusals name real released inputs", () => {
  for (const [operation, fields] of Object.entries(intentionallyRefused))
    for (const field of fields) assert.ok(field in snapshot.operations[operation].fields, `${operation}.${field}`);
});
