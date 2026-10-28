import { strict as assert } from "node:assert";
import { test } from "node:test";

// monitor-dashboard-chrome.mjs imports the real @earendil-works/pi-tui and
// @earendil-works/pi-coding-agent packages (DynamicBorder + Box) to draw the
// dashboard's top/bottom rule and background band. Neither package is
// installed in this repo -- they're only resolvable inside an actual running
// `pi` process -- so this dynamic import is expected to fail here. When it
// does, this explicitly skips with the reason instead of silently reporting
// green, per the assignment: real border/background rendering is verified by
// source-pattern assertions in monitor.test.mjs and a manual TUI smoke test
// (`cc --plugin-dir . --debug`, `/crew-dashboard`), never by this test file.
//
// If pi-tui/pi-coding-agent ever become resolvable here (e.g. this repo gains
// them as devDependencies), this test starts exercising the real chrome
// wrapper instead of skipping, with no code change required.
test("wrapDashboardChrome adds a top rule, a background band, and a bottom rule around the content", async (t) => {
  let wrapDashboardChrome;
  try {
    ({ wrapDashboardChrome } = await import("../../.pi/extensions/hall-crew/crew/lib/monitor-dashboard-chrome.mjs"));
  } catch (err) {
    t.skip(
      `@earendil-works/pi-tui / pi-coding-agent not resolvable from plain node --test in this repo (${err.code ?? err.message}); ` +
        "covered instead by source-pattern assertions in monitor.test.mjs and a manual TUI smoke test.",
    );
    return;
  }

  const theme = { fg: (_name, s) => s, bg: (_name, s) => s };
  const contentLines = ["[automata] plan", "NAME | BUCKET", "----------------", "alpha | running"];
  const content = {
    render: (width) => contentLines.map((line) => line.slice(0, width)),
    handleInput: () => {},
    invalidate: () => {},
  };

  const chrome = wrapDashboardChrome(theme, content);
  const lines = chrome.render(40);

  // Top rule, N content lines (padded by Box), bottom rule.
  assert.ok(lines.length >= contentLines.length + 2);
  assert.match(lines[0], /^─+$/);
  assert.match(lines[lines.length - 1], /^─+$/);
  for (const line of lines) assert.ok(line.length <= 40);
  assert.ok(lines.some((line) => line.includes("alpha | running")));
});
