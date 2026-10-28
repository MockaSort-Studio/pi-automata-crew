import { strict as assert } from "node:assert";
import { test } from "node:test";

// monitor-footer-widget.mjs imports the real @earendil-works/pi-tui package
// (Box/Text/getCapabilities/hyperlink), only resolvable inside an actual
// running `pi` process -- see monitor-dashboard-chrome.test.mjs's header
// comment for the full rationale, which this mirrors exactly. Covered
// instead by source-pattern assertions in monitor.test.mjs and a manual TUI
// smoke test.
test("buildFooterWidgetFactory renders one line per active Crew", async (t) => {
  let buildFooterWidgetFactory;
  try {
    ({ buildFooterWidgetFactory } = await import("../../.pi/extensions/hall-crew/crew/lib/monitor-footer-widget.mjs"));
  } catch (err) {
    t.skip(
      `@earendil-works/pi-tui not resolvable from plain node --test in this repo (${err.code ?? err.message}); ` +
        "covered instead by source-pattern assertions in monitor.test.mjs and a manual TUI smoke test.",
    );
    return;
  }

  const theme = { fg: (_name, s) => s, bg: (_name, s) => s, bold: (s) => s };
  const lines = [
    {
      view: { phase: "Working", runId: "run-aaaaaaaa", discussionNumber: null, discussionUrl: null },
      footer: "Crew a",
    },
    { view: { phase: "Queued", runId: "run-bbbbbbbb", discussionNumber: null, discussionUrl: null }, footer: "Crew b" },
  ];

  const factory = buildFooterWidgetFactory(lines);
  const box = factory(undefined, theme);
  const rendered = box.render(80).join("\n");
  assert.match(rendered, /Crew a/);
  assert.match(rendered, /Crew b/);
});
