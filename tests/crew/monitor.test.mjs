import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { crewMonitorView, isTerminalCrew } from "../../.pi/extensions/hall-crew/crew/lib/monitor-state.mjs";

const source = readFileSync(new URL("../../.pi/extensions/hall-crew/crew/lib/monitor.ts", import.meta.url), "utf8");
const footerWidgetSource = readFileSync(
  new URL("../../.pi/extensions/hall-crew/crew/lib/monitor-footer-widget.mjs", import.meta.url),
  "utf8",
);

const roster = (overrides) => ({
  runId: "run-123456",
  status: "started",
  discussionNumber: 42,
  discussionUrl: "https://github.com/org/repo/discussions/42",
  members: [],
  ...overrides,
});

test("single-Crew view derives useful runtime phases", () => {
  assert.equal(crewMonitorView(roster({ status: "queued" })).phase, "Queued");
  assert.equal(crewMonitorView(roster({ status: "starting" })).phase, "Starting");
  assert.equal(crewMonitorView(roster({ status: "closing" })).phase, "Disbanding");
  assert.equal(
    crewMonitorView(roster({ status: "closing", discussionClosed: true, members: [{}] })).phase,
    "Disbanding",
  );
  assert.equal(crewMonitorView(roster({ discussionUrl: null })).phase, "Framing");
  assert.equal(crewMonitorView(roster({})).phase, "Recruiting");
  assert.equal(crewMonitorView(roster({ members: [{ name: "architect-a" }] })).phase, "Working");
  assert.equal(crewMonitorView(roster({ members: [{}], finalCommentUrl: "https://example/final" })).phase, "Closing");
});

test("terminal Crew removes the monitor", () => {
  assert.equal(isTerminalCrew(roster({ status: "done" })), true);
  assert.equal(isTerminalCrew(roster({ status: "closing", discussionClosed: true })), false);
  assert.equal(isTerminalCrew(roster({ status: "closing", discussionClosed: true, members: [{}] })), false);
  assert.equal(crewMonitorView(roster({ status: "done" })), null);
});

test("widget is fixed above editor, clickable when supported, and cleaned up", () => {
  assert.match(source, /placement: "aboveEditor"/);
  assert.match(source, /watch\(dir/);
  assert.match(source, /session_shutdown/);
  assert.match(source, /watcher\?\.close\(\)/);
  assert.match(source, /setWidget\(WIDGET, undefined\)/);
  assert.match(source, /setInterval\(refresh, 500\)/);
  assert.match(source, /clearInterval\(reconciler\)/);
});

test("the footer widget factory (isolated in its own pi-tui-bound file) is hyperlink-aware", () => {
  assert.match(footerWidgetSource, /hyperlink\(label, view\.discussionUrl\)/);
  assert.match(footerWidgetSource, /getCapabilities\(\)\.hyperlinks/);
});

test("widget renders the live CrewMonitorSnapshot footer, not a static phase line", () => {
  assert.match(source, /import \{ crewMonitorSnapshot \} from "\.\/monitor-snapshot\.mjs"/);
  assert.match(source, /import \{ lifecycleByActor \} from "\.\/monitor-actor-state\.mjs"/);
  assert.match(source, /import \{ renderCrewStatusFooter \} from "\.\/monitor-footer\.mjs"/);
  assert.match(
    source,
    /import \{ workerMetricsByActor as workerMetricsByActorFor \} from "\.\/monitor-worker-metrics\.mjs"/,
  );
  assert.match(source, /crewMonitorSnapshot\(roster, \{/);
  assert.match(source, /renderCrewStatusFooter\(snapshot\)/);
});

test("the Crew dashboard command/shortcut are wired from monitor-dashboard.mjs data, not prose", () => {
  assert.match(source, /import \{ buildAutomataTab \} from "\.\/monitor-dashboard\.mjs"/);
  assert.match(
    source,
    /import \{ planRowsFor, registerCrewDashboardCommand, selectedCrewFor \} from "\.\/monitor-dashboard-command\.mjs"/,
  );
  assert.match(source, /registerCrewDashboardCommand\(\s*pi,\s*\(target\) => \{/);
  assert.match(source, /buildAutomataTab\(snapshot\)/);
  assert.match(source, /planRowsFor\(readJson, ctx\.cwd, roster, ledger\)/);
});

test("more than one active roster gets a Crew picker in front of the dashboard, not a silent single-roster pick", () => {
  assert.match(source, /import \{ activeRosterEntries \} from "\.\/monitor-active-rosters\.mjs"/);
  assert.match(source, /import \{ pickActiveCrew \} from "\.\/monitor-dashboard-picker\.mjs"/);
  assert.match(source, /activeRosterEntries\(entries, ACTIVE\)/);
  assert.match(
    source,
    /\(\) => scanActiveRosters\(\)\.map\(\(entry\) => \(\{ path: entry\.path, roster: entry\.roster \}\)\)/,
  );
  assert.match(source, /wrapDashboardChrome,\s*\(\) => scanActiveRosters\(\)\.map/);
  assert.match(source, /pickActiveCrew,\s*\);/);
});

test("the footer shows one line per active roster, not just the latest, bounded and reused per-Crew", () => {
  assert.match(source, /import \{ buildFooterWidgetFactory \} from "\.\/monitor-footer-widget\.mjs"/);
  assert.match(source, /const scanActiveRosters = \(\) => \{/);
  assert.match(source, /const renderAll = \(rosters\) => \{/);
  assert.match(source, /const lines = rosters\s*\.map\(\(roster\) => \{/);
  assert.match(source, /renderCrewStatusFooter\(snapshot\)/);
  assert.match(
    source,
    /ctx\.ui\.setWidget\(WIDGET, buildFooterWidgetFactory\(lines\), \{ placement: "aboveEditor" \}\)/,
  );
});

test("the Crew dashboard is given real border/background chrome, not unframed text", () => {
  // wrapDashboardChrome needs the real pi-tui/pi-coding-agent packages
  // (DynamicBorder + Box), which aren't resolvable from plain `node --test`
  // in this repo -- see monitor-dashboard-chrome.mjs's header comment. Its
  // wiring here is verified the same way the rest of monitor.ts's pi-tui
  // usage already is: source-pattern assertions, plus a manual TUI smoke
  // test (`cc --plugin-dir . --debug`, then `/crew-dashboard`).
  assert.match(source, /import \{ wrapDashboardChrome \} from "\.\/monitor-dashboard-chrome\.mjs"/);
  assert.match(source, /\},\s*wrapDashboardChrome,/);
  const chrome = readFileSync(
    new URL("../../.pi/extensions/hall-crew/crew/lib/monitor-dashboard-chrome.mjs", import.meta.url),
    "utf8",
  );
  assert.match(chrome, /import \{ Box, matchesKey \} from "@earendil-works\/pi-tui"/);
  assert.match(chrome, /matchesKey\(data, "escape"\) \? "escape" : data/);
});

test("the Plan tab reads a live ledger connected directly to the run's own Comm URL, not a same-process Runtime", () => {
  // A real Crew is launched by a separate process (the Crew MCP tool's own
  // Runtime), so a same-process runtimeFor(ctx.cwd) never observes its
  // Comm traffic -- see monitor-live-ledger.mjs's header. roster.comm.url
  // and authToken must be threaded through explicitly instead.
  assert.match(source, /import \{ createLiveLedgerTracker \} from "\.\/monitor-live-ledger\.mjs"/);
  assert.doesNotMatch(source, /runtimeFor/);
  // ledgerFor now also passes authToken parameter: roster?.comm?.authToken
  assert.match(source, /ensureLiveLedgerTracker\(\)\.ledgerFor\(selected, roster\?\.comm\?\.url/);
  assert.match(source, /liveLedgerTracker\?\.stop\(\)/);
});

test("the footer and Automata tab read live ledger status too, not only the roster-recorded one", () => {
  assert.match(source, /import \{ ledgerStatusByActor \} from "\.\/dependency-ledger-wiring\.mjs"/);
  assert.match(source, /ledgerStatusByActor\(liveLedgerFor\(roster\), roster\.members\)/);
  assert.match(source, /ledgerStatusByActor\(ledger, roster\.members\)/);
});
