import { strict as assert } from "node:assert";
import test from "node:test";
import { crewView, isActive, pickerItem, planRows } from "../../extensions/crew/crew/lib/crew-view.mjs";
import { renderCrewStatusFooter } from "../../extensions/crew/crew/lib/monitor-footer.mjs";
import { buildAutomataTab } from "../../extensions/crew/crew/lib/monitor-dashboard.mjs";

const RUN = "7f56ff8f-bb28-4e0b-95c2-cecb5f375b15";
const live = (extra = {}) => ({
  turns: 0,
  toolCalls: 0,
  toolErrors: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...extra,
});
const m = (handle, state, extra = {}) => ({ handle, state, ledger: "waiting", live: live(), ...extra });

test("the footer counts members by what they are doing and totals the output tokens as they grow", () => {
  const { line } = crewView({
    runId: RUN,
    members: [
      m("developer-a-00", "running", { live: live({ output: 1200 }) }),
      m("reviewer-b-00", "held"),
      m("developer-c-00", "completed", { live: live({ output: 300 }) }),
      m("developer-d-00", "needs_input"),
    ],
  });
  assert.equal(line.view.phase, "Working");
  assert.equal(line.view.runId, "7f56ff8f");
  assert.equal(
    line.footer,
    "Crew 7f56ff8f · 4 automata · 1 running · 1 queued · 1 needs attention · 1 complete · 1.5k output tokens",
  );
});

test("the phase tells Main whether it is needed", () => {
  const phase = (...states) =>
    crewView({ runId: RUN, members: states.map((s, i) => m(`developer-m${i}-00`, s)) }).line.view.phase;
  assert.equal(phase("queued"), "Queued");
  assert.equal(phase("completed", "failed"), "Needs you");
  assert.equal(phase("completed", "cancelled"), "Done");
  assert.equal(phase("running", "failed"), "Working");
});

test("a crew whose members have all ended is no longer active; one waiting on Main still is", () => {
  assert.equal(isActive([m("a", "completed"), m("b", "cancelled")]), false);
  assert.equal(isActive([m("a", "completed"), m("b", "failed")]), true);
});

test("the Automata tab shows each member's live turns, tools, errors and tokens", () => {
  const { snapshot } = crewView({
    runId: RUN,
    members: [
      m("developer-a-00", "running", {
        live: live({ turns: 3, toolCalls: 7, toolErrors: 1, input: 900, output: 40, cacheRead: 11 }),
      }),
    ],
  });
  const [row] = buildAutomataTab(snapshot);
  assert.deepEqual(
    [row.name, row.bucket, row.turns, row.toolCalls, row.toolErrors],
    ["developer-a-00", "running", 3, 7, 1],
  );
  assert.deepEqual(row.providerTraffic, { uncachedInput: 900, generatedOutput: 40, cacheRead: 11, cacheWrite: 0 });
  assert.equal(renderCrewStatusFooter(snapshot).includes("40 output tokens"), true);
});

test("the Automata tab and snapshot show each member's context usage", () => {
  const { snapshot } = crewView({
    runId: RUN,
    members: [
      m("developer-a-00", "running", { live: live({ context: { percent: 37.5, window: 128000 } }) }),
      m("developer-b-00", "running", { live: live({ context: { percent: 0.4, window: 128000 } }) }),
      m("developer-c-00", "running", { live: live({ context: { percent: null, window: 64000 } }) }),
      m("developer-d-00", "queued", { live: live({ context: null }) }),
      m("developer-e-00", "queued"),
    ],
  });
  assert.deepEqual(
    buildAutomataTab(snapshot).map((row) => row.sessionContext),
    ["38% / 128k", "0% / 128k", "— / 64k", "— / —", "— / —"],
  );
  assert.deepEqual(snapshot.contextSummary, { maxPercent: 38, modelWindows: [128000, 64000] });
});

test("the Plan tab lists each assignment with its dependencies and live status", () => {
  const plan = [
    { handle: "developer-a-00", task: "write it", dependsOn: [] },
    { handle: "reviewer-b-00", task: "check it", dependsOn: ["developer-a-00"] },
  ];
  assert.deepEqual(
    planRows({ plan, members: [m("developer-a-00", "running"), m("reviewer-b-00", "held", { ledger: "blocked" })] }),
    [
      { task: "write it", status: "running", assignedAutomaton: "developer-a-00", dependsOn: [] },
      { task: "check it", status: "blocked", assignedAutomaton: "reviewer-b-00", dependsOn: ["developer-a-00"] },
    ],
  );
  const after = planRows({
    plan,
    members: [m("developer-a-00", "completed"), m("reviewer-b-00", "queued", { ledger: "ready" })],
  });
  assert.deepEqual(
    after.map((row) => row.status),
    ["complete", "ready"],
  );
});

test("the picker names a crew by id and phase", () => {
  assert.deepEqual(pickerItem({ runId: RUN, members: [m("developer-a-00", "failed")] }), {
    value: RUN,
    label: "Crew 7f56ff8f · Needs you",
    description: "1 member",
  });
});
