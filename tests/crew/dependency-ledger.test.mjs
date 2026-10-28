import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  NODE_STATES,
  canTransition,
  isTerminalStatus,
  createDependencyLedger,
} from "../../.pi/extensions/hall-crew/crew/lib/dependency-ledger.mjs";

test("NODE_STATES exposes the durable ledger vocabulary", () => {
  assert.deepEqual(NODE_STATES, ["waiting", "ready", "running", "complete", "blocked", "failed"]);
});

test("isTerminalStatus is true only for complete, blocked, failed", () => {
  assert.equal(isTerminalStatus("complete"), true);
  assert.equal(isTerminalStatus("blocked"), true);
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

test("running may wait and resume, while blocked remains terminal", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-01");
  ledger.start("developer-alpha-01");
  assert.equal(ledger.wait("developer-alpha-01"), "waiting");
  assert.equal(ledger.start("developer-alpha-01"), "running");
  assert.equal(ledger.block("developer-alpha-01"), "blocked");
  assert.throws(() => ledger.start("developer-alpha-01"), /Illegal dependency ledger transition/);
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
