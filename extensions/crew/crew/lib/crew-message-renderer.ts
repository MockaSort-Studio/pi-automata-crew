import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { buildCrewMessageChrome } from "./crew-message-chrome.mjs";

// Renders incoming `crew-message` deliveries (untrusted worker payloads) inside the
// original-style custom-message card chrome -- a `customMessageBg` background band
// with a bold `[crew-message]` label -- with the deterministic Markdown body (see
// crew-message-view.mjs) underneath. Falls back to the raw message text for any shape
// this can't parse, so a malformed or adversarial payload degrades to plain text
// instead of breaking the TUI.
export function registerCrewMessageRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer("crew-message", (message, options, theme) => {
    try {
      return buildCrewMessageChrome(message as { content?: string }, theme, getMarkdownTheme(), options.outputPad, {
        expanded: options.expanded,
        keyHint: (binding, description) => options.keyHint(binding, description),
      });
    } catch {
      return new Text(theme.fg("customMessageText", String(message?.content ?? "")), options.outputPad, 0);
    }
  });
}
