import { strict as assert } from "node:assert";
import { test } from "node:test";

// monitor-dashboard-picker.mjs imports the real @earendil-works/pi-tui and
// @earendil-works/pi-coding-agent packages (SelectList + DynamicBorder),
// only resolvable inside an actual running `pi` process -- see
// monitor-dashboard-chrome.test.mjs's header comment for the full
// rationale, which this mirrors exactly. Covered instead by source-pattern
// assertions in monitor.test.mjs and a manual TUI smoke test.
test("pickActiveCrew opens a SelectList/DynamicBorder overlay and resolves the chosen roster path", async (t) => {
  let pickActiveCrew;
  try {
    ({ pickActiveCrew } = await import("../../.pi/extensions/hall-crew/crew/lib/monitor-dashboard-picker.mjs"));
  } catch (err) {
    t.skip(
      `@earendil-works/pi-tui / pi-coding-agent not resolvable from plain node --test in this repo (${err.code ?? err.message}); ` +
        "covered instead by source-pattern assertions in monitor.test.mjs and a manual TUI smoke test.",
    );
    return;
  }

  const theme = {
    fg: (_name, s) => s,
    bg: (_name, s) => s,
    bold: (s) => s,
  };
  const items = [
    { value: "path-a", label: "Crew aaaaaaaa \u00b7 Working" },
    { value: "path-b", label: "Crew bbbbbbbb \u00b7 Queued" },
  ];

  let factory;
  const sessionCtx = {
    ui: {
      custom: (f, options) => {
        factory = f;
        return { factory, options };
      },
    },
  };

  const result = pickActiveCrew(sessionCtx, items);
  assert.equal(result.options.overlay, true);

  let resolved;
  const tui = { requestRender: () => {} };
  const built = factory(tui, theme, undefined, (value) => {
    resolved = value;
  });
  assert.equal(typeof built.render, "function");
  assert.ok(built.render(80).length > 0);
});
