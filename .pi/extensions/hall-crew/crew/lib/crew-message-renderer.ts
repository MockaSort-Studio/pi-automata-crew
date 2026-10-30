import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { renderCrewMessageMarkdown } from "./crew-message-view.mjs";

// Renders incoming `crew-message` deliveries (untrusted worker payloads) as readable
// Markdown. Falls back to the raw message text for any shape this can't parse, so a
// malformed or adversarial payload degrades to plain text instead of breaking the TUI.
export function registerCrewMessageRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer("crew-message", (message, { outputPad }, theme) => {
    try {
      const markdownText = renderCrewMessageMarkdown(message as { content?: string });
      return new Markdown(markdownText, outputPad, 0, getMarkdownTheme());
    } catch {
      return new Text(theme.fg("customMessageText", String(message?.content ?? "")), outputPad, 0);
    }
  });
}
