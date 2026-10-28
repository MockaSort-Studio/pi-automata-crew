import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  openDashboard,
  planRowsFor,
  registerCrewDashboardCommand,
} from "../../.pi/extensions/hall-crew/crew/lib/monitor-dashboard-command.mjs";
import { seedDependencyLedgerFromSelectedCrew } from "../../.pi/extensions/hall-crew/crew/lib/dependency-ledger-wiring.mjs";

const selectedCrew = {
  runId: "run-1",
  members: [
    { name: "alpha", handle: "developer-alpha-00", task: "Do alpha work.", dependsOn: [] },
    { name: "bravo", handle: "developer-bravo-00", task: "Do bravo work.", dependsOn: ["developer-alpha-00"] },
  ],
};

const roster = { selectedCrew: ".pi/runtime/crew-launch/selected_crew_run-1.json" };

test("planRowsFor reads selected_crew via the injected readJson and seeds a fresh ledger", () => {
  const readJson = (path) => {
    assert.match(path, /selected_crew_run-1\.json$/);
    return selectedCrew;
  };
  const rows = planRowsFor(readJson, "/repo", roster);
  assert.deepEqual(rows, [
    { task: "Do alpha work.", status: "waiting", assignedAutomaton: "developer-alpha-00", dependsOn: [] },
    {
      task: "Do bravo work.",
      status: "waiting",
      assignedAutomaton: "developer-bravo-00",
      dependsOn: ["developer-alpha-00"],
    },
  ]);
});

test("planRowsFor returns no rows when the roster has no selectedCrew file recorded", () => {
  assert.deepEqual(
    planRowsFor(() => null, "/repo", {}),
    [],
  );
});

test("planRowsFor returns no rows when selected_crew fails to parse", () => {
  assert.deepEqual(
    planRowsFor(() => null, "/repo", roster),
    [],
  );
});

test("planRowsFor uses an injected live ledger's status instead of reseeding a fresh one", () => {
  const ledger = seedDependencyLedgerFromSelectedCrew(selectedCrew);
  ledger.start("developer-alpha-00");
  const readJson = () => selectedCrew;
  const rows = planRowsFor(readJson, "/repo", roster, ledger);
  assert.deepEqual(rows, [
    { task: "Do alpha work.", status: "running", assignedAutomaton: "developer-alpha-00", dependsOn: [] },
    {
      task: "Do bravo work.",
      status: "waiting",
      assignedAutomaton: "developer-bravo-00",
      dependsOn: ["developer-alpha-00"],
    },
  ]);
});

// openDashboard's ui.custom factory is where border/background chrome gets
// applied to the dashboard's content component (monitor-dashboard-view.mjs's
// createCrewDashboardComponent output) -- see monitor-dashboard-chrome.mjs.
// This file stays free of any pi-tui import (wrapChrome is always injected,
// never imported here), so these fakes stand in for the real theme/chrome
// wiring monitor.ts supplies in the real TUI.
function fakeSessionCtx() {
  let factory;
  return {
    ui: {
      custom: (f, options) => {
        factory = f;
        return { factory, options };
      },
    },
    getFactory: () => factory,
  };
}

test("openDashboard wraps the content component with the injected chrome, passing the real theme through", () => {
  const sessionCtx = fakeSessionCtx();
  const theme = { fg: (_name, s) => s, bg: (_name, s) => s };
  let wrapArgs;
  const wrapChrome = (t, content) => {
    wrapArgs = { theme: t, content };
    return { wrapped: true, render: content.render, handleInput: content.handleInput, invalidate: content.invalidate };
  };
  const result = openDashboard(sessionCtx, () => ({ automataRows: [], planRows: [] }), wrapChrome);
  const built = sessionCtx.getFactory()(undefined, theme, undefined, () => {});
  assert.equal(built.wrapped, true);
  assert.equal(wrapArgs.theme, theme);
  assert.equal(typeof wrapArgs.content.render, "function");
  assert.equal(result.options.overlay, true);
  assert.equal(result.options.overlayOptions.width, "50%");
});

// Regression guard for the minWidth-is-a-floor gotcha (pi-tui's
// resolveOverlayLayout does `width = Math.max(width, minWidth)`): minWidth
// must cover the Automata table's real minimum content width so the panel
// is never pinned to an illegibly narrow floor on typical terminals.
test("openDashboard sets minWidth to the Automata table's computed minimum content width", () => {
  const sessionCtx = fakeSessionCtx();
  const result = openDashboard(sessionCtx, () => ({ automataRows: [], planRows: [] }));
  assert.equal(result.options.overlayOptions.minWidth, 120);
});

test("openDashboard closes when the component receives Pi's named Escape key", () => {
  const sessionCtx = fakeSessionCtx();
  let closed = false;
  openDashboard(
    sessionCtx,
    () => ({ automataRows: [], planRows: [] }),
    (_theme, content) => content,
  );
  const built = sessionCtx.getFactory()(undefined, { fg: (_n, s) => s, bg: (_n, s) => s }, undefined, () => {
    closed = true;
  });
  built.handleInput("escape");
  assert.equal(closed, true);
});

test("openDashboard falls back to the unframed content component when no chrome is injected", () => {
  const sessionCtx = fakeSessionCtx();
  openDashboard(sessionCtx, () => ({ automataRows: [], planRows: [] }));
  const built = sessionCtx.getFactory()(undefined, { fg: (_n, s) => s, bg: (_n, s) => s }, undefined, () => {});
  assert.equal(built.wrapped, undefined);
  assert.equal(typeof built.render, "function");
});

// registerCrewDashboardCommand's picker orchestration: fakePi captures both
// the /crew-dashboard command handler and the ctrl+shift+d shortcut handler
// so both entry points are exercised without a real ExtensionAPI.
function fakePi() {
  const handlers = {};
  return {
    registerCommand: (name, def) => {
      handlers[name] = def.handler;
    },
    registerShortcut: (_key, def) => {
      handlers.shortcut = def.handler;
    },
    handlers,
  };
}

test("registerCrewDashboardCommand skips the picker and opens directly when at most one roster is active", async () => {
  const pi = fakePi();
  const seen = [];
  const getData = (target) => {
    seen.push(target);
    return { automataRows: [], planRows: [] };
  };
  let pickCalled = false;
  registerCrewDashboardCommand(
    pi,
    getData,
    undefined,
    () => [{ path: "only-active-path", roster: { runId: "run-1", status: "started", members: [] } }],
    async () => {
      pickCalled = true;
      return "never";
    },
  );

  const sessionCtx = fakeSessionCtx();
  await pi.handlers["crew-dashboard"]("", sessionCtx);
  const built = sessionCtx.getFactory()(undefined, { fg: (_n, s) => s, bg: (_n, s) => s }, undefined, () => {});
  built.render(80);

  assert.equal(pickCalled, false);
  assert.deepEqual(seen, ["only-active-path"]);
});

test("registerCrewDashboardCommand shows the picker when more than one roster is active, and opens the chosen one", async () => {
  const pi = fakePi();
  const seen = [];
  const getData = (target) => {
    seen.push(target);
    return { automataRows: [], planRows: [] };
  };
  const entries = [
    { path: "path-a", roster: { runId: "run-a", status: "started", members: [] } },
    { path: "path-b", roster: { runId: "run-b", status: "queued", members: [] } },
  ];
  let pickArgs;
  registerCrewDashboardCommand(
    pi,
    getData,
    undefined,
    () => entries,
    async (_sessionCtx, items) => {
      pickArgs = items;
      return "path-b";
    },
  );

  const sessionCtx = fakeSessionCtx();
  await pi.handlers.shortcut(sessionCtx);
  const built = sessionCtx.getFactory()(undefined, { fg: (_n, s) => s, bg: (_n, s) => s }, undefined, () => {});
  built.render(80);

  assert.equal(pickArgs.length, 2);
  assert.deepEqual(seen, ["path-b"]);
});

test("registerCrewDashboardCommand never opens the dashboard when the picker is cancelled", async () => {
  const pi = fakePi();
  let opened = false;
  const getData = () => {
    opened = true;
    return { automataRows: [], planRows: [] };
  };
  const entries = [
    { path: "path-a", roster: { runId: "run-a", status: "started", members: [] } },
    { path: "path-b", roster: { runId: "run-b", status: "queued", members: [] } },
  ];
  registerCrewDashboardCommand(
    pi,
    getData,
    undefined,
    () => entries,
    async () => undefined,
  );

  await pi.handlers["crew-dashboard"]("", fakeSessionCtx());
  assert.equal(opened, false);
});
