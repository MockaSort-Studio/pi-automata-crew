import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDependencyLedger } from "../../.pi/extensions/hall-crew/crew/lib/dependency-ledger.mjs";
import {
  ledgerStatusByActor,
  readableDependencyLedgerSnapshot,
  seedDependencyLedgerFromSelectedCrew,
} from "../../.pi/extensions/hall-crew/crew/lib/dependency-ledger-wiring.mjs";

const selectedCrew = () => ({
  members: [
    { name: "alpha", handle: "developer-alpha-00", task: "Do alpha work.", dependsOn: [] },
    { name: "bravo", handle: "developer-bravo-00", task: "Do bravo work.", dependsOn: ["developer-alpha-00"] },
  ],
});

test("seedDependencyLedgerFromSelectedCrew records nodes and dependency edges", () => {
  const ledger = seedDependencyLedgerFromSelectedCrew(selectedCrew());
  assert.deepEqual(ledger.nodes().sort(), ["developer-alpha-00", "developer-bravo-00"]);
  assert.deepEqual(ledger.dependenciesOf("developer-bravo-00"), ["developer-alpha-00"]);
  assert.equal(ledger.status("developer-alpha-00"), "waiting");
});

test("seedDependencyLedgerFromSelectedCrew tolerates missing members", () => {
  assert.deepEqual(seedDependencyLedgerFromSelectedCrew({}).nodes(), []);
});

test("readableDependencyLedgerSnapshot merges status with task text", () => {
  const ledger = seedDependencyLedgerFromSelectedCrew(selectedCrew());
  assert.deepEqual(readableDependencyLedgerSnapshot(ledger, selectedCrew().members), [
    { handle: "developer-alpha-00", status: "waiting", dependsOn: [], task: "Do alpha work." },
    { handle: "developer-bravo-00", status: "waiting", dependsOn: ["developer-alpha-00"], task: "Do bravo work." },
  ]);
});

test("ledgerStatusByActor only projects tracked named members", () => {
  const ledger = createDependencyLedger();
  ledger.addNode("developer-alpha-00");
  ledger.start("developer-alpha-00");
  assert.deepEqual(
    ledgerStatusByActor(ledger, [
      { actorId: "actor-1", name: "developer-alpha-00" },
      { actorId: "actor-2", name: "unknown" },
    ]),
    { "actor-1": "running" },
  );
});
