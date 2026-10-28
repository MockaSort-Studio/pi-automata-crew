import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createCrewDashboardComponent,
  formatAutomataLines,
  formatPlanLines,
} from "../../.pi/extensions/hall-crew/crew/lib/monitor-dashboard-view.mjs";

const automataRow = () => ({
  actorId: "a1",
  name: "architect-a",
  bucket: "running",
  turns: 3,
  toolCalls: 5,
  toolErrors: 1,
  compactions: 2,
  providerTraffic: { uncachedInput: 100, generatedOutput: 200, cacheRead: 10, cacheWrite: 20 },
  sessionContext: "42% / 200000",
});

const planRow = () => ({
  task: "Do the thing.",
  status: "running",
  assignedAutomaton: "developer-alpha-00",
  dependsOn: [],
});

test("formatAutomataLines emits a header, a divider, and one line per automaton with bucket, metrics, and context", () => {
  const lines = formatAutomataLines([automataRow()]);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /BUCKET/);
  assert.match(lines[1], /^[\u2500\u253c]+$/);
  assert.match(lines[2], /architect-a/);
  assert.match(lines[2], /running/);
  assert.match(lines[2], /42% \/ 200000/);
});

test("formatAutomataLines aligns the header and data row into equal-width columns", () => {
  const lines = formatAutomataLines([automataRow()]);
  const [header, divider, row] = lines;
  assert.equal(header.length, row.length);
  assert.equal(divider.length, row.length);
});

test("formatAutomataLines shrinks the flexible NAME column, never the fixed metric columns, on a narrow width", () => {
  const wide = formatAutomataLines([automataRow()], 120);
  const narrow = formatAutomataLines([automataRow()], 60);
  assert.ok(narrow[0].length < wide[0].length);
  // The bucket/turns/tools/etc columns are unaffected -- their content is
  // still present even once NAME has been squeezed down.
  assert.match(narrow[2], /running/);
});

test("formatAutomataLines reports an explicit empty state instead of a blank table", () => {
  assert.deepEqual(formatAutomataLines([]), ["(no automata on the roster yet)"]);
});

test("formatPlanLines renders a header, a divider, and task, status, assigned automaton, and dependsOn per row", () => {
  const lines = formatPlanLines([{ ...planRow(), dependsOn: ["developer-bravo-00"] }]);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /AUTOMATON/);
  assert.match(lines[1], /^[\u2500\u253c]+$/);
  assert.match(lines[2], /developer-alpha-00/);
  assert.match(lines[2], /running/);
  assert.match(lines[2], /developer-bravo-00/);
  assert.match(lines[2], /Do the thing\./);
});

test("formatPlanLines reports an explicit empty state instead of a blank table", () => {
  assert.deepEqual(formatPlanLines([]), ["(no plan recorded for this Crew yet)"]);
});

test("createCrewDashboardComponent starts on the Automata tab and switches on Tab input", () => {
  const component = createCrewDashboardComponent({
    getData: () => ({ automataRows: [automataRow()], planRows: [planRow()] }),
  });
  assert.equal(component.tab, "automata");
  component.handleInput("\t");
  assert.equal(component.tab, "plan");
  component.handleInput("\t");
  assert.equal(component.tab, "automata");
});

test("createCrewDashboardComponent renders the active tab's rows and respects width", () => {
  const component = createCrewDashboardComponent({
    getData: () => ({ automataRows: [automataRow()], planRows: [planRow()] }),
  });
  const lines = component.render(20);
  assert.ok(lines.every((line) => line.length <= 20));
  component.handleInput("\t");
  const planLines = component.render(200);
  assert.ok(planLines.some((line) => line.includes("developer-alpha-00")));
});

test("createCrewDashboardComponent's table widens to fill a larger overlay render width", () => {
  const component = createCrewDashboardComponent({
    getData: () => ({ automataRows: [automataRow()], planRows: [planRow()] }),
  });
  const narrow = component.render(70)[2];
  const wide = component.render(140)[2];
  assert.ok(wide.length > narrow.length);
});

test("createCrewDashboardComponent pads content with a blank line after the tab bar and one before the closing border", () => {
  const component = createCrewDashboardComponent({
    getData: () => ({ automataRows: [automataRow()], planRows: [planRow()] }),
  });
  const lines = component.render(120);
  assert.equal(lines[1], "");
  assert.equal(lines[lines.length - 1], "");
  assert.match(lines[0], /Crew dashboard/);
  assert.match(lines[2], /BUCKET/);
});

test("createCrewDashboardComponent's breathing-room blank lines survive an empty-rows state", () => {
  const component = createCrewDashboardComponent({
    getData: () => ({ automataRows: [], planRows: [] }),
  });
  const lines = component.render(80);
  assert.equal(lines[1], "");
  assert.equal(lines[lines.length - 1], "");
  assert.match(lines[2], /no automata on the roster yet/);
});

test("createCrewDashboardComponent calls onClose on escape or q", () => {
  let closed = 0;
  const component = createCrewDashboardComponent({
    getData: () => ({ automataRows: [], planRows: [] }),
    onClose: () => closed++,
  });
  component.handleInput("\x1b");
  component.handleInput("q");
  assert.equal(closed, 2);
});
