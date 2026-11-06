// Builds the terminal chrome (background band + `[crew-message]` label) around a
// `crew-message` delivery's Markdown body. Isolated in its own file for the same
// reason as monitor-dashboard-chrome.mjs / monitor-footer-widget.mjs: Box, Markdown,
// Spacer, and Text are only resolvable inside an actual running `pi` process, never
// from plain `node --test` in this repo. This keeps crew-message-renderer.ts's own
// pi-tui wiring covered by source-pattern assertions in crew-message-renderer.test.mjs,
// while this file's own chrome assembly is covered by behavior assertions in
// crew-message-chrome.test.mjs (skipped, with the reason stated, when pi-tui isn't
// resolvable -- same pattern as monitor-footer-widget.test.mjs).
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { isShortened, renderCrewMessageMarkdown } from "./crew-message-view.mjs";

export const CREW_MESSAGE_LABEL = "[crew-message]";

// Renders a `crew-message` delivery with the same custom-message card chrome used
// elsewhere in this extension (background band + bold bracketed label), with the
// deterministic Markdown body (see crew-message-view.mjs) underneath. The raw
// message content is only ever reshaped into Markdown text, never reinterpreted.
export function buildCrewMessageChrome(
  message,
  theme,
  markdownTheme,
  outputPad = 1,
  { expanded = false, keyHint } = {},
) {
  const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(CREW_MESSAGE_LABEL)), 0, 0));
  box.addChild(new Spacer(1));
  const markdownText = renderCrewMessageMarkdown(message, { expanded });
  box.addChild(
    new Markdown(markdownText, 0, 0, markdownTheme, {
      color: (text) => theme.fg("customMessageText", text),
    }),
  );
  if (isShortened(message) && !expanded && keyHint) {
    box.addChild(new Spacer(1));
    box.addChild(new Text(theme.fg("dim", `(${keyHint("app.tools.expand", "to expand the full report")})`), 0, 0));
  }
  return box;
}
