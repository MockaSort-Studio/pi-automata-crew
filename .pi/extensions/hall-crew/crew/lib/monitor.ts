import { CONFIG_DIR_NAME, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { crewMonitorView } from "./monitor-state.mjs";
import { renderCrewStatusFooter } from "./monitor-footer.mjs";
import { crewMonitorSnapshot } from "./monitor-snapshot.mjs";
import { lifecycleByActor } from "./monitor-actor-state.mjs";
import { buildAutomataTab } from "./monitor-dashboard.mjs";
import { planRowsFor, registerCrewDashboardCommand, selectedCrewFor } from "./monitor-dashboard-command.mjs";
import { wrapDashboardChrome } from "./monitor-dashboard-chrome.mjs";
import { createLiveLedgerTracker } from "./monitor-live-ledger.mjs";
import { ledgerStatusByActor } from "./dependency-ledger-wiring.mjs";
import { activeRosterEntries } from "./monitor-active-rosters.mjs";
import { pickActiveCrew } from "./monitor-dashboard-picker.mjs";
import { buildFooterWidgetFactory } from "./monitor-footer-widget.mjs";
import { workerMetricsByActor as workerMetricsByActorFor } from "./monitor-worker-metrics.mjs";

const WIDGET = "crew-monitor";
const ACTIVE = new Set(["queued", "launching", "starting", "started", "closing"]);

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const workerMetricsByActor = (cwd, roster) => workerMetricsByActorFor(cwd, CONFIG_DIR_NAME, roster);

export function registerCrewMonitor(pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let activePath: string | undefined;
  let watcher: FSWatcher | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let reconciler: ReturnType<typeof setInterval> | undefined;
  // Lazily created and kept for the life of the session: one live ledger
  // tracker per process, so the Plan tab reads a ledger kept current by a
  // direct WS connection to that run's own Comm controller (roster.comm.url)
  // instead of planRowsFor reseeding a fresh structural-only one on every
  // open. Not scoped to a Runtime -- the run may have been launched by a
  // completely different process (see monitor-live-ledger.mjs's header).
  let liveLedgerTracker: ReturnType<typeof createLiveLedgerTracker> | undefined;
  const ensureLiveLedgerTracker = () => (liveLedgerTracker ??= createLiveLedgerTracker());

  // A member's own completion report updates the live dependency ledger
  // immediately (dependency-ledger-wiring.mjs); its roster-recorded status
  // only advances when Main explicitly reconciles it. Bridge the two so the
  // footer and Automata tab can show "complete"/"blocked"/"failed" as soon
  // as the worker itself reports it, not only once Main gets around to
  // acting -- see monitor-snapshot.mjs's bucketFor precedence.
  const liveLedgerFor = (roster) => {
    if (!ctx) return undefined;
    const selected = selectedCrewFor(readJson, ctx.cwd, roster);
    return selected
      ? ensureLiveLedgerTracker().ledgerFor(selected, roster?.comm?.url, roster?.comm?.authToken)
      : undefined;
  };

  const root = () => (ctx ? join(ctx.cwd, CONFIG_DIR_NAME, "runtime", "crew-launch") : undefined);
  // Every currently-active roster, most-recently-touched first, bounded to
  // MAX_ACTIVE_ROSTERS -- see monitor-active-rosters.mjs. The footer and the
  // dashboard picker both read from this single scan so a second (or third)
  // concurrent Crew is never silently dropped from either surface.
  const scanActiveRosters = () => {
    const dir = root();
    if (!dir || !existsSync(dir)) return [];
    const entries = readdirSync(dir)
      .filter((name) => name.endsWith("-roster.json"))
      .map((name) => {
        const path = join(dir, name);
        return { path, roster: readJson(path), mtimeMs: statSync(path).mtimeMs };
      });
    return activeRosterEntries(entries, ACTIVE);
  };
  const latestActive = () => scanActiveRosters()[0]?.path;

  const clear = () => ctx?.ui.setWidget(WIDGET, undefined);
  // One compact footer line per active roster, each built exactly the way
  // the old single-Crew footer was: crewMonitorView for the phase/icon,
  // crewMonitorSnapshot + renderCrewStatusFooter for the counts line. A
  // second (or third) concurrent Crew now gets its own line instead of
  // silently losing the widget to whichever roster was touched last.
  const renderAll = (rosters) => {
    if (!ctx) {
      clear();
      return;
    }
    const lines = rosters
      .map((roster) => {
        const view = crewMonitorView(roster);
        if (!view) return null;
        const snapshot = crewMonitorSnapshot(roster, {
          lifecycleByActor: lifecycleByActor(roster),
          workerMetricsByActor: workerMetricsByActor(ctx!.cwd, roster),
          ledgerStatusByActor: ledgerStatusByActor(liveLedgerFor(roster), roster.members),
        });
        return { view, footer: renderCrewStatusFooter(snapshot) };
      })
      .filter(
        (line): line is { view: NonNullable<ReturnType<typeof crewMonitorView>>; footer: string } => line != null,
      );
    if (!lines.length) {
      clear();
      return;
    }
    ctx.ui.setWidget(WIDGET, buildFooterWidgetFactory(lines), { placement: "aboveEditor" });
  };

  const refresh = () => {
    if (!ctx || ctx.mode !== "tui") return;
    const entries = scanActiveRosters();
    activePath = entries[0]?.path;
    if (!entries.length) {
      clear();
      return;
    }
    renderAll(entries.map((entry) => entry.roster));
  };

  const schedule = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(refresh, 60);
  };
  const reconcile = () => {
    if (!reconciler) reconciler = setInterval(refresh, 500);
  };

  const ensureWatcher = () => {
    const dir = root();
    if (watcher || !dir || !existsSync(dir)) return;
    watcher = watch(dir, (_event, filename) => {
      if (!filename || filename.endsWith("-roster.json")) schedule();
    });
  };

  const stop = () => {
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    if (reconciler) clearInterval(reconciler);
    reconciler = undefined;
    watcher?.close();
    watcher = undefined;
    activePath = undefined;
    liveLedgerTracker?.stop();
    liveLedgerTracker = undefined;
    clear();
    ctx = undefined;
  };

  pi.on("session_start", (_event, sessionCtx) => {
    ctx = sessionCtx;
    if (ctx.mode !== "tui") return;
    ensureWatcher();
    reconcile();
    refresh();
  });
  pi.on("session_shutdown", stop);

  // Command-activated dashboard: when more than one roster is active, a
  // picker (monitor-dashboard-picker.mjs) lets the user choose which
  // Crew's dashboard to open; with zero or one active roster it opens
  // directly, same as before this file gained multi-Crew awareness. Either
  // way, rows come from crewMonitorSnapshot / monitor-dashboard.mjs, never
  // from prose.
  registerCrewDashboardCommand(
    pi,
    (target) => {
      const path = target ?? activePath ?? latestActive();
      const roster = path ? readJson(path) : null;
      if (!ctx || !roster) return { automataRows: [], planRows: [] };
      const ledger = liveLedgerFor(roster);
      const snapshot = crewMonitorSnapshot(roster, {
        lifecycleByActor: lifecycleByActor(roster),
        workerMetricsByActor: workerMetricsByActor(ctx.cwd, roster),
        ledgerStatusByActor: ledgerStatusByActor(ledger, roster.members),
      });
      return { automataRows: buildAutomataTab(snapshot), planRows: planRowsFor(readJson, ctx.cwd, roster, ledger) };
    },
    wrapDashboardChrome,
    () => scanActiveRosters().map((entry) => ({ path: entry.path, roster: entry.roster })),
    pickActiveCrew,
  );

  return {
    // rosterPath is the file prepareCrew just wrote; refresh() rescans the
    // whole crew-launch directory immediately below and picks it up on its
    // own merit (freshest mtime), so there is nothing else to pin here --
    // this just guarantees ctx/watcher/reconciler are ready before that scan.
    activate(sessionCtx: ExtensionContext, _rosterPath: string) {
      ctx = sessionCtx;
      if (ctx.mode !== "tui") return;
      ensureWatcher();
      reconcile();
      refresh();
    },
  };
}
