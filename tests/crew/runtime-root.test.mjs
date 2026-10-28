import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertOwnedRunId, crewRoot } from "../../.pi/extensions/hall-crew/crew/lib/runtime-root.mjs";

test("crewRoot returns only the explicit owned cwd, never an env-discovered host root", () => {
  const previous = process.env.PI_CREW_ROOT;
  process.env.PI_CREW_ROOT = "/some/host/repo";
  try {
    assert.equal(crewRoot("/owned/worker/worktree"), "/owned/worker/worktree");
  } finally {
    if (previous === undefined) delete process.env.PI_CREW_ROOT;
    else process.env.PI_CREW_ROOT = previous;
  }
});

test("crewRoot fails closed without an explicit cwd", () => {
  assert.throws(() => crewRoot(""), /explicit owned cwd/);
  assert.throws(() => crewRoot(undefined), /explicit owned cwd/);
});

test("assertOwnedRunId accepts a plain run identifier", () => {
  assert.equal(assertOwnedRunId("run-1"), "run-1");
});

test("assertOwnedRunId fails closed on path traversal and cross-run attempts", () => {
  for (const runId of ["../other-run", "..%2f..%2fetc", "/etc/passwd", "run 1", "", undefined]) {
    assert.throws(() => assertOwnedRunId(runId), /Refusing cross-run\/host state access/);
  }
});
