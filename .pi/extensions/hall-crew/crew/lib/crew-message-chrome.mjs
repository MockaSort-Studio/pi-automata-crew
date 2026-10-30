// Builds the terminal chrome (background band + `[crew-message]` label) around a
// `crew-message` delivery's Markdown body. It stays separate from the pure formatter
// because pi-tui components are available only in a running Pi terminal.
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { renderCrewMessageMarkdown } from "./crew-message-view.mjs";

export const CREW_MESSAGE_LABEL = "[crew-message]";

// Renders a `crew-message` delivery with the same custom-message card chrome used
// elsewhere in this extension (background band + bold bracketed label), with the
// deterministic Markdown body (see crew-message-view.mjs) underneath. The raw
// message content is only ever reshaped into Markdown text, never reinterpreted.
export function buildCrewMessageChrome(message, theme, markdownTheme, outputPad = 1) {
  const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(CREW_MESSAGE_LABEL)), 0, 0));
  box.addChild(new Spacer(1));
  const markdownText = renderCrewMessageMarkdown(message);
  box.addChild(
    new Markdown(markdownText, 0, 0, markdownTheme, {
      color: (text) => theme.fg("customMessageText", text),
    }),
  );
  return box;
}
