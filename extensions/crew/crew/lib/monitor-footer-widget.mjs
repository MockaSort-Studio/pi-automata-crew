// Builds the footer widget's pi-tui render factory: one themed line per
// active Crew (see monitor.ts's renderAll), each already reduced to a
// { view, footer } pair by crewMonitorView + renderCrewStatusFooter before
// reaching here. Isolated in its own file for the same reason as
// monitor-dashboard-chrome.mjs / monitor-dashboard-picker.mjs: Box,
// getCapabilities, hyperlink, and Text are only resolvable inside an actual
// running `pi` process, never from plain `node --test` in this repo. This
// keeps monitor.ts's own footer wiring covered by source-pattern assertions
// in monitor.test.mjs, same as the rest of its pi-tui usage.
import { Box, getCapabilities, hyperlink, Text } from "@earendil-works/pi-tui";

export function buildFooterWidgetFactory(lines) {
  return (_tui, theme) => {
    const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
    for (const { view, footer } of lines) {
      const icon = view.phase === "Queued" ? "\u25cc" : "\u25c9";
      let text = theme.fg("accent", theme.bold(`${icon} ${footer || `Crew ${view.runId.slice(0, 8)}`}`));
      if (view.discussionNumber && view.discussionUrl) {
        const label = `#${view.discussionNumber} \u2197`;
        const link = getCapabilities().hyperlinks
          ? hyperlink(label, view.discussionUrl)
          : `${label} ${view.discussionUrl}`;
        text += ` \u00b7 ${theme.fg("accent", link)}`;
      }
      box.addChild(new Text(text, 0, 0));
    }
    return box;
  };
}
