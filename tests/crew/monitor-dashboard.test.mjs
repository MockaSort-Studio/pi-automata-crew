import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAutomataTab, buildPlanTab } from "../../.pi/extensions/hall-crew/crew/lib/monitor-dashboard.mjs";

test("buildAutomataTab passes through the snapshot's per-automaton detail rows", () => {
  const row = { actorId: "a1", name: "architect-a", bucket: "running" };
  assert.deepEqual(buildAutomataTab({ automata: [row] }), [row]);
});

test("buildAutomataTab tolerates a missing or malformed snapshot", () => {
  assert.deepEqual(buildAutomataTab(null), []);
  assert.deepEqual(buildAutomataTab({}), []);
});

const selectedCrew = () => ({
  runId: "run-1",
  members: [
    { name: "alpha", handle: "developer-alpha-00", task: "Do alpha work.", dependsOn: [] },
    { name: "bravo", handle: "developer-bravo-00", task: "Do bravo work.", dependsOn: ["developer-alpha-00"] },
  ],
});

test("buildPlanTab sources task and dependsOn from selected_crew, never from prose", () => {
  const rows = buildPlanTab({ selectedCrew: selectedCrew() });
  assert.deepEqual(rows, [
    { task: "Do alpha work.", status: "unknown", assignedAutomaton: "developer-alpha-00", dependsOn: [] },
    {
      task: "Do bravo work.",
      status: "unknown",
      assignedAutomaton: "developer-bravo-00",
      dependsOn: ["developer-alpha-00"],
    },
  ]);
});

test("buildPlanTab overlays live status from a dependency-ledger-wiring readable snapshot by handle", () => {
  const rows = buildPlanTab({
    selectedCrew: selectedCrew(),
    ledgerSnapshot: [
      { handle: "developer-alpha-00", status: "running", dependsOn: [], task: "Do alpha work." },
      { handle: "developer-bravo-00", status: "waiting", dependsOn: ["developer-alpha-00"], task: "Do bravo work." },
    ],
  });
  assert.equal(rows.find((row) => row.assignedAutomaton === "developer-alpha-00").status, "running");
  assert.equal(rows.find((row) => row.assignedAutomaton === "developer-bravo-00").status, "waiting");
});

test("buildPlanTab tolerates a missing or malformed selected_crew document", () => {
  assert.deepEqual(buildPlanTab({}), []);
  assert.deepEqual(buildPlanTab({ selectedCrew: { members: [] } }), []);
});
