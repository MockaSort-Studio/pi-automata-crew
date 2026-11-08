import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  NODE_STATES,
  canTransition,
  isSettledStatus,
  isTerminalStatus,
  createDependencyLedger,
} from "../../extensions/crew/crew/lib/dependency-ledger.mjs";

test("NODE_STATES exposes the durable ledger vocabulary", () => {
  assert.deepEqual(NODE_STATES, ["waiting", "ready", "running", "complete", "blocked", "failed"]);
});

test("isTerminalStatus is true only for complete and failed; blocked is settled but resumable", () => {
  assert.equal(isTerminalStatus("complete"), true);
  assert.equal(isTerminalStatus("blocked"), false);
  assert.equal(isSettledStatus("blocked"), true);
  assert.equal(isSettledStatus("running"), false);
  assert.equal(isTerminalStatus("failed"), true);
  assert.equal(isTerminalStatus("waiting"), false);
  assert.equal(isTerminalStatus("ready"), false);
  assert.equal(isTerminalStatus("running"), false);
});

test("canTransition allows only the documented legal edges", () => {
  assert.equal(canTransition("waiting", "ready"), true);
  assert.equal(canTransition("waiting", "blocked"), true);
  assert.equal(canTransition("ready", "running"), true);
  assert.equal(canTransition("running", "complete"), true);
  assert.equal(canTransition("running", "failed"), true);
  assert.equal(canTransition("running", "waiting"), true);
  assert.equal(canTransition("waiting", "running"), true);
  assert.equal(canTransition("complete", "ready"), false);
});

test("a self-blocked node resumes to running and can then complete; failed stays terminal", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.addNode("developer-bravo-01");
  ledger.start("developer-alpha-01");
  assert.equal(ledger.wait("developer-alpha-01"), "waiting");
  assert.equal(ledger.start("developer-alpha-01"), "running");
  assert.equal(ledger.block("developer-alpha-01"), "blocked");
  assert.equal(ledger.start("developer-alpha-01"), "running");
  assert.equal(ledger.block("developer-alpha-01"), "blocked");
  assert.equal(ledger.wait("developer-alpha-01"), "waiting");
  assert.equal(ledger.start("developer-alpha-01"), "running");
  assert.equal(ledger.complete("developer-alpha-01"), "complete");
  ledger.start("developer-bravo-01");
  ledger.fail("developer-bravo-01");
  assert.throws(() => ledger.start("developer-bravo-01"), /Illegal dependency ledger transition/);
});

test("dependents blocked by a prerequisite recover when it resumes, and are released once it completes", () => {
  const ledger = createDependencyLedger();
  for (const handle of ["developer-alpha-01", "developer-bravo-01", "developer-charlie-01"]) ledger.addNode(handle);
  ledger.addDependency("developer-bravo-01", "developer-alpha-01");
  ledger.addDependency("developer-charlie-01", "developer-bravo-01");
  ledger.start("developer-alpha-01");
  ledger.block("developer-alpha-01");
  assert.equal(ledger.status("developer-charlie-01"), "blocked");
  assert.throws(() => ledger.start("developer-bravo-01"), /blocked by a prerequisite/);
  assert.throws(() => ledger.wait("developer-charlie-01"), /blocked by a prerequisite/);
  ledger.start("developer-alpha-01");
  assert.equal(ledger.status("developer-bravo-01"), "waiting");
  assert.equal(ledger.status("developer-charlie-01"), "waiting");
  ledger.complete("developer-alpha-01");
  assert.equal(ledger.status("developer-bravo-01"), "ready");
  assert.equal(ledger.status("developer-charlie-01"), "waiting");
});

test("a dependent stays blocked while any other prerequisite still holds it", () => {
  const ledger = createDependencyLedger();
  for (const handle of ["developer-alpha-01", "developer-bravo-01", "developer-charlie-01"]) ledger.addNode(handle);
  ledger.addDependency("developer-charlie-01", "developer-alpha-01");
  ledger.addDependency("developer-charlie-01", "developer-bravo-01");
  ledger.start("developer-alpha-01");
  ledger.start("developer-bravo-01");
  ledger.block("developer-alpha-01");
  ledger.fail("developer-bravo-01");
  ledger.start("developer-alpha-01");
  assert.equal(ledger.status("developer-charlie-01"), "blocked");
});

test("addNode rejects handles that are not canonical role-persona names", () => {
  const ledger = createDependencyLedger();
  assert.throws(() => ledger.addNode("Not A Handle"), /role-persona handle/);
});

test("addNode rejects duplicate registration", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-snowball-01");
  assert.throws(() => ledger.addNode("developer-snowball-01"), /already exists/);
});

test("a node with no dependencies starts waiting and stays waiting until moved", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-snowball-01");
  assert.equal(ledger.status("developer-snowball-01"), "waiting");
});

test("addDependency rejects unknown handles on either side", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-snowball-01");
  assert.throws(() => ledger.addDependency("developer-snowball-01", "developer-ghost-01"), /Unknown/);
  assert.throws(() => ledger.addDependency("developer-ghost-01", "developer-snowball-01"), /Unknown/);
});

test("addDependency rejects a self-dependency", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-snowball-01");
  assert.throws(
    () => ledger.addDependency("developer-snowball-01", "developer-snowball-01"),
    /cannot depend on itself/,
  );
});

test("addDependency rejects an edge that would close a cycle", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.addNode("developer-bravo-01");
  ledger.addNode("developer-charlie-01");
  ledger.addDependency("developer-bravo-01", "developer-alpha-01");
  ledger.addDependency("developer-charlie-01", "developer-bravo-01");
  assert.throws(() => ledger.addDependency("developer-alpha-01", "developer-charlie-01"), /would create a cycle/);
});

test("a node becomes ready once every prerequisite completes", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.addNode("developer-bravo-01");
  ledger.addDependency("developer-bravo-01", "developer-alpha-01");
  assert.equal(ledger.status("developer-bravo-01"), "waiting");

  ledger.start("developer-alpha-01");
  ledger.complete("developer-alpha-01");
  assert.equal(ledger.status("developer-alpha-01"), "complete");
  assert.equal(ledger.status("developer-bravo-01"), "ready");
});

test("a node with multiple prerequisites waits for all of them", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.addNode("developer-bravo-01");
  ledger.addNode("developer-charlie-01");
  ledger.addDependency("developer-charlie-01", "developer-alpha-01");
  ledger.addDependency("developer-charlie-01", "developer-bravo-01");

  ledger.start("developer-alpha-01");
  ledger.complete("developer-alpha-01");
  assert.equal(ledger.status("developer-charlie-01"), "waiting");

  ledger.start("developer-bravo-01");
  ledger.complete("developer-bravo-01");
  assert.equal(ledger.status("developer-charlie-01"), "ready");
});

test("running node completes and takes the full waiting -> running -> complete path", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  assert.equal(ledger.start("developer-alpha-01"), "running");
  assert.equal(ledger.complete("developer-alpha-01"), "complete");
  assert.throws(() => ledger.start("developer-alpha-01"), /Illegal dependency ledger transition/);
});

test("failing a node propagates blocked to its downstream dependents", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.addNode("developer-bravo-01");
  ledger.addNode("developer-charlie-01");
  ledger.addDependency("developer-bravo-01", "developer-alpha-01");
  ledger.addDependency("developer-charlie-01", "developer-bravo-01");

  ledger.start("developer-alpha-01");
  ledger.fail("developer-alpha-01");

  assert.equal(ledger.status("developer-alpha-01"), "failed");
  assert.equal(ledger.status("developer-bravo-01"), "blocked");
  assert.equal(ledger.status("developer-charlie-01"), "blocked");
});

test("explicitly blocking a node propagates blocked downstream but not upstream", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.addNode("developer-bravo-01");
  ledger.addDependency("developer-bravo-01", "developer-alpha-01");

  ledger.block("developer-bravo-01");

  assert.equal(ledger.status("developer-bravo-01"), "blocked");
  assert.equal(ledger.status("developer-alpha-01"), "waiting");
});

test("dependenciesOf and dependentsOf report the recorded edges", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.addNode("developer-bravo-01");
  ledger.addDependency("developer-bravo-01", "developer-alpha-01");

  assert.deepEqual(ledger.dependenciesOf("developer-bravo-01"), ["developer-alpha-01"]);
  assert.deepEqual(ledger.dependentsOf("developer-alpha-01"), ["developer-bravo-01"]);
});

test("snapshot exposes a plain object of handle -> status", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  assert.deepEqual(ledger.snapshot(), { "developer-alpha-01": "waiting" });
});

test("a completed node can be reopened: dependents that have not started wait again, started ones are left alone", () => {
  const ledger = createDependencyLedger();
  for (const handle of ["developer-a-00", "developer-b-00", "developer-c-00", "developer-d-00"]) ledger.addNode(handle);
  ledger.addDependency("developer-b-00", "developer-a-00");
  ledger.addDependency("developer-c-00", "developer-a-00");
  ledger.addDependency("developer-d-00", "developer-a-00");
  ledger.start("developer-a-00");
  ledger.complete("developer-a-00");
  assert.deepEqual(
    ["developer-b-00", "developer-c-00", "developer-d-00"].map((handle) => ledger.status(handle)),
    ["ready", "ready", "ready"],
  );
  ledger.start("developer-c-00");
  ledger.start("developer-d-00");
  ledger.complete("developer-d-00");

  assert.equal(ledger.reopen("developer-a-00"), "running");
  assert.equal(ledger.status("developer-b-00"), "waiting", "not started: depends on a result that is in question");
  assert.equal(ledger.status("developer-c-00"), "running", "already running: left alone");
  assert.equal(ledger.status("developer-d-00"), "complete", "already complete: left alone");

  ledger.complete("developer-a-00");
  assert.equal(ledger.status("developer-b-00"), "ready", "and it is released again by the new result");
});

test("a reopened node can end as blocked or failed, and only a complete node can be reopened", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-a-00");
  ledger.addNode("developer-b-00");
  ledger.addDependency("developer-b-00", "developer-a-00");
  assert.throws(() => ledger.reopen("developer-a-00"), /Illegal dependency ledger transition/);
  ledger.start("developer-a-00");
  ledger.complete("developer-a-00");
  ledger.reopen("developer-a-00");
  ledger.block("developer-a-00");
  assert.equal(ledger.status("developer-a-00"), "blocked");
  assert.equal(ledger.status("developer-b-00"), "blocked", "what waits on it is held");
  ledger.start("developer-a-00");
  ledger.complete("developer-a-00");
  assert.throws(() => ledger.fail("developer-a-00"), /Illegal/, "failing a node that is not running is still illegal");
  ledger.reopen("developer-a-00");
  ledger.fail("developer-a-00");
  assert.equal(ledger.status("developer-a-00"), "failed");
});

test("cancel ends a node that waits, is ready, or is blocked by itself or a prerequisite, and holds what follows", () => {
  const ledger = createDependencyLedger();
  for (const handle of ["developer-a-00", "developer-b-00", "developer-c-00"]) ledger.addNode(handle);
  ledger.addDependency("developer-b-00", "developer-a-00");
  ledger.addDependency("developer-c-00", "developer-b-00");
  ledger.start("developer-a-00");
  ledger.block("developer-a-00");
  assert.equal(ledger.status("developer-b-00"), "blocked");
  assert.throws(() => ledger.start("developer-b-00"), /blocked by a prerequisite/);
  assert.equal(ledger.cancel("developer-b-00"), "failed", "a prerequisite-blocked node can still be cancelled");
  assert.equal(ledger.status("developer-c-00"), "blocked");
  ledger.cancel("developer-a-00");
  assert.equal(ledger.status("developer-a-00"), "failed");
  assert.throws(() => ledger.start("developer-a-00"), /Illegal/, "a cancelled node is not resumed");
  assert.throws(() => ledger.cancel("developer-a-00"), /failed -> failed \(cancel\)/);
  const running = createDependencyLedger();
  running.addNode("developer-d-00");
  running.start("developer-d-00");
  assert.throws(() => running.cancel("developer-d-00"), /running -> failed \(cancel\)/, "a running node fails instead");
});
