// Registers the command + shortcut that open the Crew dashboard overlay.
// Kept separate from monitor.ts so that file stays focused on the footer
// widget's own lifecycle; `getData` is the only seam this needs, supplied
// by the caller which already knows how to resolve the active roster.
import { join } from "node:path";
import { createCrewDashboardComponent } from "./monitor-dashboard-view.mjs";
import { buildPlanTab } from "./monitor-dashboard.mjs";
import { readableDependencyLedgerSnapshot, seedDependencyLedgerFromSelectedCrew } from "./dependency-ledger-wiring.mjs";
import { crewPickerItems } from "./monitor-active-rosters.mjs";

// Reads the durable selected_crew_<uuid>.json plan document for a roster,
// resolved from roster.selectedCrew (a path relative to cwd, written by
// prepareCrew). Absent until a Crew's plan is recorded, or once its files
// are cleaned up.
export const selectedCrewFor = (readJson, cwd, roster) =>
  roster.selectedCrew ? readJson(join(cwd, roster.selectedCrew)) : null;

// Plan tab rows: task/dependsOn come from selected_crew_<uuid>.json, live
// status comes from `ledger` when the caller has one (monitor.ts's
// monitor-live-ledger.mjs tracker, kept current by live kickoff/report
// envelopes via attachRawEnvelopeObserver) -- otherwise falls back to a
// fresh ledger seeded from the same plan, which only ever reports
// structural "waiting"/"ready" state. Either way, status is always
// programmatically sourced, never report/prose.
export function planRowsFor(readJson, cwd, roster, ledger) {
  const selected = selectedCrewFor(readJson, cwd, roster);
  if (!selected) return [];
  const activeLedger = ledger ?? seedDependencyLedgerFromSelectedCrew(selected);
  const ledgerSnapshot = readableDependencyLedgerSnapshot(activeLedger, selected.members ?? []);
  return buildPlanTab({ selectedCrew: selected, ledgerSnapshot });
}

// GOTCHA: pi-tui's resolveOverlayLayout treats minWidth as a floor, not a
// fallback -- it always does `width = Math.max(width, minWidth)`, so
// minWidth wins over the `width` percentage on any terminal narrower than
// minWidth / (percentage/100). Do not treat minWidth as "the width when
// the percentage would be too small": on most real terminals it is simply
// the width, full stop. Size it to the content's actual minimum, not a
// guess, or the percentage becomes decorative.
//
// minWidth is set to the Automata tab's real minimum content width,
// computed from AUTOMATA_COLUMNS in monitor-dashboard-view.mjs:
//   BUCKET 9 ("attention" is the longest bucket value) + TURNS 5 + TOOLS 5
//   + ERRS 4 + IN 7 + OUT 7 + CACHE R/W 15 ("1234567/1234567") + CTX 14
//   ("100% / 1000000") + COMPACT 7 = 73 fixed-column chars, plus 9 SEP
//   (" \u2502 ", 3 chars) between the 10 columns = 27, plus a NAME flex
//   column wide enough to show a full Crew handle like
//   "developer-frontenzo-00" (22 chars) without truncation = ~20.
//   73 + 27 + 20 = 120.
// width is set above that floor (50%) so wide terminals (>= ~240 cols)
// get a panel that actually grows instead of pinning to the floor forever.
const DASHBOARD_OVERLAY_OPTIONS = Object.freeze({
  width: "50%",
  minWidth: 120,
  maxHeight: "80%",
  anchor: "center",
  margin: 1,
});

// wrapChrome is optional and injected (never imported here) so this file
// stays free of pi-tui imports and importable by plain `node --test`: see
// monitor-dashboard-chrome.mjs for why. monitor.ts is the only real caller
// and always passes wrapDashboardChrome; omitting it (as tests do) falls
// back to the unframed content component instead of throwing.
export const openDashboard = (sessionCtx, getData, wrapChrome) =>
  sessionCtx.ui.custom(
    (_tui, theme, _keybindings, done) => {
      const content = createCrewDashboardComponent({ getData, onClose: () => done(undefined) });
      return wrapChrome ? wrapChrome(theme, content) : content;
    },
    { overlay: true, overlayOptions: DASHBOARD_OVERLAY_OPTIONS },
  );

// `getData` now takes an optional target roster path (the one the picker
// resolved, or the caller's single-Crew fallback when there's nothing to
// pick between). `listActiveEntries`/`pickCrew` are both optional so
// existing single-Crew callers (and tests) keep working unchanged: with no
// `listActiveEntries`, or zero/one active entries, the picker step is
// skipped entirely and behavior is identical to before this file gained
// multi-Crew awareness.
async function resolveTarget(sessionCtx, listActiveEntries, pickCrew) {
  const entries = listActiveEntries ? listActiveEntries() : [];
  if (entries.length <= 1 || !pickCrew) return { target: entries[0]?.path, cancelled: false };
  const target = await pickCrew(sessionCtx, crewPickerItems(entries));
  return { target, cancelled: target === undefined };
}

export function registerCrewDashboardCommand(pi, getData, wrapChrome, listActiveEntries, pickCrew) {
  const openWithPicker = async (sessionCtx) => {
    const { target, cancelled } = await resolveTarget(sessionCtx, listActiveEntries, pickCrew);
    if (cancelled) return;
    await openDashboard(sessionCtx, () => getData(target), wrapChrome);
  };

  pi.registerCommand("crew-dashboard", {
    description: "Open the Crew dashboard (Automata / Plan tabs)",
    handler: async (_args, sessionCtx) => openWithPicker(sessionCtx),
  });
  pi.registerShortcut("ctrl+shift+d", {
    description: "Open the Crew dashboard",
    handler: async (sessionCtx) => openWithPicker(sessionCtx),
  });
}
