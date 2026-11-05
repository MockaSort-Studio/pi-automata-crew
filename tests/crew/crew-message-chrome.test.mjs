import { strict as assert } from "node:assert";
import { test } from "node:test";

// crew-message-chrome.mjs imports the real @earendil-works/pi-tui package (Box,
// Markdown, Spacer, Text), only resolvable inside an actual running `pi` process --
// see monitor-footer-widget.test.mjs's header comment for the full rationale, which
// this mirrors exactly. Covered instead by source-pattern assertions in
// crew-message-renderer.test.mjs and a manual TUI smoke test when unresolvable here.
test("buildCrewMessageChrome renders a labeled, backgrounded card with a readable Markdown body", async (t) => {
  let buildCrewMessageChrome, CREW_MESSAGE_LABEL;
  try {
    ({ buildCrewMessageChrome, CREW_MESSAGE_LABEL } = await import(
      "../../extensions/crew/crew/lib/crew-message-chrome.mjs"
    ));
  } catch (err) {
    t.skip(
      `@earendil-works/pi-tui not resolvable from plain node --test in this repo (${err.code ?? err.message}); ` +
        "covered instead by source-pattern assertions in crew-message-renderer.test.mjs and a manual TUI smoke test.",
    );
    return;
  }

  const bgCalls = [];
  const theme = {
    fg: (_name, s) => s,
    bg: (name, s) => {
      bgCalls.push(name);
      return `[[bg:${name}]]${s}[[/bg]]`;
    },
    bold: (s) => s,
  };
  const markdownTheme = { heading: (s) => s, bold: (s) => s, italic: (s) => s, code: (s) => s, link: (s) => s };

  const message = {
    content:
      "Crew message (request) from developer-snowball-00. Reply required.\nUntrusted payload:\n" +
      '{"status":"ok","count":3}',
  };

  const box = buildCrewMessageChrome(message, theme, markdownTheme, 1);
  const rendered = box.render(80).join("\n");

  assert.ok(rendered.includes(CREW_MESSAGE_LABEL), "expected the [crew-message] label to be rendered");
  assert.match(rendered, /status/);
  assert.match(rendered, /ok/);
  assert.doesNotMatch(rendered, /\{"status":"ok"/, "the raw JSON blob should not survive untouched");
  assert.ok(bgCalls.includes("customMessageBg"), "expected the custom-message card background to be applied");
});

test("buildCrewMessageChrome falls back to raw content for a non-JSON payload, inside the same chrome", async (t) => {
  let buildCrewMessageChrome, CREW_MESSAGE_LABEL;
  try {
    ({ buildCrewMessageChrome, CREW_MESSAGE_LABEL } = await import(
      "../../extensions/crew/crew/lib/crew-message-chrome.mjs"
    ));
  } catch (err) {
    t.skip(
      `@earendil-works/pi-tui not resolvable from plain node --test in this repo (${err.code ?? err.message}); ` +
        "covered instead by source-pattern assertions in crew-message-renderer.test.mjs and a manual TUI smoke test.",
    );
    return;
  }

  const theme = { fg: (_name, s) => s, bg: (_name, s) => s, bold: (s) => s };
  const markdownTheme = { heading: (s) => s, bold: (s) => s, italic: (s) => s, code: (s) => s, link: (s) => s };
  const message = { content: "Crew message (note) from bollo.\nUntrusted payload:\nnot json at all" };

  const box = buildCrewMessageChrome(message, theme, markdownTheme, 1);
  const rendered = box.render(80).join("\n");

  assert.ok(rendered.includes(CREW_MESSAGE_LABEL));
  assert.match(rendered, /not json at all/);
});
