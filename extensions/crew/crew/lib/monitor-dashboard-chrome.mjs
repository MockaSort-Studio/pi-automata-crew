// Wraps the pure Crew dashboard content component (monitor-dashboard-view.mjs's
// createCrewDashboardComponent output) with real border + background chrome.
//
// This lives in its own file, imported only by monitor.ts, instead of inside
// monitor-dashboard-view.mjs itself: both @earendil-works/pi-tui and
// @earendil-works/pi-coding-agent are only resolvable inside an actual running
// `pi` process, never from plain `node --test` in this repo (same constraint
// already documented on monitor-actor-state.mjs). A top-level import of either
// package from a file any test statically imports (monitor-dashboard-view.mjs,
// monitor-dashboard-command.mjs) would fail module resolution and take down
// every other -- otherwise pure and passing -- test in that file. Keeping the
// pi-tui import confined to this file, wired in only from monitor.ts, mirrors
// how monitor.ts already imports Box/Text directly for the footer widget, and
// is verified the same way: source-pattern assertions in monitor.test.mjs plus
// a manual TUI smoke test. Plain `node --test` cannot exercise this file's own
// border/background rendering -- there is no way around that in this repo's
// dependency layout, so it is not covered by node --test.
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Box, matchesKey } from "@earendil-works/pi-tui";

// Box only supports padding + background (see its own render()); it has no
// border option. DynamicBorder is the documented fallback for a top/bottom
// rule. There is no vertical-side-border primitive in pi-tui (DynamicBorder
// draws a horizontal rule only, and every existing pattern -- BorderedLoader,
// SelectList's preset.ts framing -- pairs it with padding, not side bars), so
// the framing here is: a top rule, a padded+backgrounded content band, a
// bottom rule.
export function wrapDashboardChrome(theme, content) {
  const borderColor = (s) => theme.fg("border", s);
  const top = new DynamicBorder(borderColor);
  const bottom = new DynamicBorder(borderColor);
  const box = new Box(1, 0, (s) => theme.bg("customMessageBg", s));
  // Forward Box's content width straight to the pure content component
  // instead of adding an intermediate Text child, so the dashboard's own
  // table truncation (formatAutomataLines/formatPlanLines) sees the real
  // available width and Box's padding/background apply to already-final
  // rendered lines.
  box.addChild({
    render: (width) => content.render(width),
    invalidate: () => content.invalidate?.(),
  });

  return {
    render: (width) => [...top.render(width), ...box.render(width), ...bottom.render(width)],
    // Linux terminals can encode Escape differently from macOS. Normalize via
    // pi-tui's parser before the pure component sees the key name.
    handleInput: (data) => content.handleInput?.(matchesKey(data, "escape") ? "escape" : data),
    invalidate() {
      top.invalidate();
      bottom.invalidate();
      box.invalidate();
    },
  };
}
