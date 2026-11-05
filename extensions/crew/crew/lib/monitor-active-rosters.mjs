// Pure helpers for the multi-Crew-aware footer/dashboard: given roster file
// entries already read from disk by the caller (monitor.ts owns all fs
// access, same split as the rest of this directory), decide which rosters
// are "active" right now, in what order, and how the dashboard picker
// should describe them. No fs/pi-tui import, so this is directly testable
// with plain `node --test`.
import { crewMonitorView } from "./monitor-state.mjs";

// A pile of old active rosters left on disk (e.g. a crashed cleanup) must
// never make the footer or the dashboard picker grow without bound.
export const MAX_ACTIVE_ROSTERS = 5;

// entries: [{ path, roster, mtimeMs }]. Returns every entry whose roster
// status is in activeStatuses, most-recently-touched first, bounded to
// `max`. This is the single source of truth both the footer (one line per
// entry) and the dashboard picker (one item per entry) read from, so they
// can never disagree about which Crews are "active".
export function activeRosterEntries(entries, activeStatuses, max = MAX_ACTIVE_ROSTERS) {
  return entries
    .filter((entry) => activeStatuses.has(entry.roster?.status))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, max);
}

// Builds SelectItem-shaped rows for the dashboard picker: reuses
// crewMonitorView so the picker's phase label can never drift from the
// footer's own phase derivation. Entries whose roster has gone terminal
// between the scan and the render (crewMonitorView returns null) are
// dropped rather than shown with stale text.
export function crewPickerItems(entries) {
  return entries
    .map((entry) => {
      const view = crewMonitorView(entry.roster);
      if (!view) return null;
      return {
        value: entry.path,
        label: `Crew ${view.runId.slice(0, 8)} \u00b7 ${view.phase}`,
        description: view.discussionUrl ?? undefined,
      };
    })
    .filter(Boolean);
}
