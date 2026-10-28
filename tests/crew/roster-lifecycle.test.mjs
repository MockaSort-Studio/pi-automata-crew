import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  advanceMemberLifecycle,
  advanceMemberToOutcome,
  applyMemberOutcomeToRoster,
  applyMemberOutcomeToRosterFiles,
  applyWorkerStatusToRoster,
  applyWorkerStatusToRosterFiles,
  outcomeForWorkerStatus,
  rosterStatusForTerminalMembers,
} from "../../.pi/extensions/hall-crew/crew/lib/roster-lifecycle.mjs";

test("outcomeForWorkerStatus maps completed/failed/removed to the durable contract's outcomes", () => {
  assert.equal(outcomeForWorkerStatus("completed"), "PASS");
  assert.equal(outcomeForWorkerStatus("failed"), "FAIL");
  assert.equal(outcomeForWorkerStatus("removed"), "BLOCKED");
  assert.equal(outcomeForWorkerStatus("stopping"), null);
});

test("advanceMemberLifecycle takes a running member straight to PASS or FAIL", () => {
  assert.equal(advanceMemberLifecycle("running", "completed"), "PASS");
  assert.equal(advanceMemberLifecycle("running", "failed"), "FAIL");
});

test("advanceMemberLifecycle routes an intentional removal through attention to BLOCKED", () => {
  assert.equal(advanceMemberLifecycle("running", "removed"), "BLOCKED");
  assert.equal(advanceMemberLifecycle("attention", "removed"), "BLOCKED");
});

test("advanceMemberLifecycle is a no-op once a member is already terminal", () => {
  assert.equal(advanceMemberLifecycle("PASS", "failed"), "PASS");
  assert.equal(advanceMemberLifecycle("FAIL", "removed"), "FAIL");
  assert.equal(advanceMemberLifecycle("BLOCKED", "completed"), "BLOCKED");
});

test("advanceMemberLifecycle rejects an unknown worker status by leaving state unchanged", () => {
  assert.equal(advanceMemberLifecycle("running", "stopping"), "running");
});

test("applyWorkerStatusToRoster defaults an unset member status to running before advancing", () => {
  const roster = { runId: "run-1", members: [{ name: "a", actorId: "actor-a" }] };
  const next = applyWorkerStatusToRoster(roster, "actor-a", "completed");
  assert.equal(next.members[0].status, "PASS");
  assert.notEqual(next, roster);
});

test("applyWorkerStatusToRoster returns the same reference when the actor is not a member", () => {
  const roster = { runId: "run-1", members: [{ name: "a", actorId: "actor-a" }] };
  assert.equal(applyWorkerStatusToRoster(roster, "actor-missing", "completed"), roster);
});

test("applyWorkerStatusToRoster returns the same reference once a member is already terminal", () => {
  const roster = { runId: "run-1", members: [{ name: "a", actorId: "actor-a", status: "PASS" }] };
  assert.equal(applyWorkerStatusToRoster(roster, "actor-a", "failed"), roster);
});

function tmpCrewLaunchDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("applyWorkerStatusToRosterFiles updates only the roster listing the actor and reports the change", () => {
  const dir = tmpCrewLaunchDir("crew-lifecycle-");
  try {
    const activePath = join(dir, "run-active-roster.json");
    const otherPath = join(dir, "run-other-roster.json");
    writeFileSync(
      activePath,
      JSON.stringify({ runId: "run-active", status: "started", members: [{ name: "a", actorId: "actor-a" }] }),
    );
    writeFileSync(
      otherPath,
      JSON.stringify({ runId: "run-other", status: "started", members: [{ name: "b", actorId: "actor-b" }] }),
    );

    const updated = applyWorkerStatusToRosterFiles(dir, "actor-a", "failed");

    assert.deepEqual(updated, [{ runId: "run-active", actorId: "actor-a", status: "FAIL" }]);
    assert.equal(JSON.parse(readFileSync(activePath, "utf8")).members[0].status, "FAIL");
    assert.equal(JSON.parse(readFileSync(otherPath, "utf8")).members[0].status, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyWorkerStatusToRosterFiles is a no-op when no Crews were ever launched", () => {
  const dir = join(tmpdir(), `crew-lifecycle-missing-${process.pid}-${Date.now()}`);
  assert.deepEqual(applyWorkerStatusToRosterFiles(dir, "actor-a", "completed"), []);
});

test("rosterStatusForTerminalMembers returns null until every member is terminal", () => {
  assert.equal(rosterStatusForTerminalMembers([]), null);
  assert.equal(rosterStatusForTerminalMembers([{ status: "PASS" }, { status: "running" }]), null);
});
test("rosterStatusForTerminalMembers marks the roster done once every member reached PASS", () => {
  assert.equal(rosterStatusForTerminalMembers([{ status: "PASS" }, { status: "PASS" }]), "done");
});
test("rosterStatusForTerminalMembers marks the roster done regardless of which outcome wins", () => {
  assert.equal(rosterStatusForTerminalMembers([{ status: "PASS" }, { status: "BLOCKED" }]), "done");
  assert.equal(rosterStatusForTerminalMembers([{ status: "PASS" }, { status: "FAIL" }, { status: "BLOCKED" }]), "done");
});

test("applyWorkerStatusToRoster rolls the roster up to a terminal status once the last member lands, across separate calls", () => {
  let roster = {
    runId: "run-multi",
    status: "started",
    members: [
      { name: "a", actorId: "actor-a" },
      { name: "b", actorId: "actor-b" },
    ],
  };
  // Stopping one worker at a time, as separate runtime_delete_agent calls
  // do, must still roll the roster up once the last member lands -- not
  // only when every member is removed in a single batch.
  roster = applyWorkerStatusToRoster(roster, "actor-a", "completed");
  assert.equal(roster.status, "started");
  roster = applyWorkerStatusToRoster(roster, "actor-b", "completed");
  assert.equal(roster.status, "done");
});
test("rosterStatusForTerminalMembers treats a lead member the same as a specialist for worst-outcome-wins", () => {
  // The Lead is carried inside roster.members (with role: "lead") in
  // addition to the summary roster.lead pointer other tools use for
  // addressing -- the rollup must not special-case or skip it.
  assert.equal(
    rosterStatusForTerminalMembers([
      { role: "lead", status: "FAIL" },
      { role: "specialist", status: "PASS" },
    ]),
    "done",
  );
  assert.equal(
    rosterStatusForTerminalMembers([
      { role: "lead", status: "PASS" },
      { role: "specialist", status: "BLOCKED" },
    ]),
    "done",
  );
  assert.equal(
    rosterStatusForTerminalMembers([
      { role: "lead", status: "PASS" },
      { role: "specialist", status: "PASS" },
    ]),
    "done",
  );
});

test("applyWorkerStatusToRoster withholds rollup until the lead's own member entry is also terminal", () => {
  let roster = {
    runId: "run-lead",
    status: "started",
    lead: { name: "lead-alpha-00", actorId: "actor-lead" },
    members: [
      { name: "lead-alpha-00", actorId: "actor-lead", role: "lead" },
      { name: "dev-beta-00", actorId: "actor-dev", role: "specialist" },
    ],
  };
  roster = applyWorkerStatusToRoster(roster, "actor-dev", "completed");
  assert.equal(roster.status, "started");
  roster = applyWorkerStatusToRoster(roster, "actor-lead", "failed");
  assert.equal(roster.status, "done");
  assert.equal(roster.members.find((m) => m.actorId === "actor-lead").status, "FAIL");
});

test("applyWorkerStatusToRoster never overwrites an already-terminal roster status", () => {
  const roster = {
    runId: "run-1",
    status: "done",
    members: [{ name: "a", actorId: "actor-a" }],
  };
  const next = applyWorkerStatusToRoster(roster, "actor-a", "completed");
  assert.equal(next.status, "done");
  assert.equal(next.members[0].status, "PASS");
});

test("advanceMemberToOutcome routes BLOCKED through attention like the worker-status path does", () => {
  assert.equal(advanceMemberToOutcome("running", "PASS"), "PASS");
  assert.equal(advanceMemberToOutcome("running", "BLOCKED"), "BLOCKED");
  assert.equal(advanceMemberToOutcome("PASS", "FAIL"), "PASS", "no-op once terminal");
});
test("applyMemberOutcomeToRoster lets Main record PASS for a resident worker that reported done before removal", () => {
  // A resident worker never exits on its own after finishing an assignment,
  // so LifecycleController.remove() always finalizes it as "removed" --
  // which the automatic path maps to BLOCKED. This is the fix: Main already
  // received and accepted the report, so it declares the real outcome
  // directly instead of letting removal imply "stalled unattended".
  const roster = { runId: "run-1", status: "started", members: [{ name: "a", actorId: "actor-a" }] };
  const next = applyMemberOutcomeToRoster(roster, "actor-a", "PASS");
  assert.equal(next.members[0].status, "PASS");
  assert.equal(next.status, "done");
});
test("applyMemberOutcomeToRosterFiles updates only the roster listing the actor", () => {
  const dir = tmpCrewLaunchDir("crew-lifecycle-outcome-");
  try {
    const path = join(dir, "run-active-roster.json");
    writeFileSync(
      path,
      JSON.stringify({ runId: "run-active", status: "started", members: [{ name: "a", actorId: "actor-a" }] }),
    );
    const updated = applyMemberOutcomeToRosterFiles(dir, "actor-a", "PASS");
    assert.deepEqual(updated, [{ runId: "run-active", actorId: "actor-a", status: "PASS" }]);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).status, "done");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
