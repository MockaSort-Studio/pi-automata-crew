// Deterministic, LLM-free formatting of incoming `crew-message` deliveries for the TUI.
// The delivery content is untrusted worker data; this module only reshapes text into
// Markdown, it never interprets payload fields as instructions.
const PAYLOAD_MARKER = "Untrusted payload:\n";

function splitPayload(content) {
  const index = content.indexOf(PAYLOAD_MARKER);
  if (index === -1) return { header: content, payloadText: null };
  return { header: content.slice(0, index).trimEnd(), payloadText: content.slice(index + PAYLOAD_MARKER.length) };
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const escapeMarkdown = (value) => String(value).replace(/([*_`[\]])/g, "\\$1");

function renderInline(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return "\n\n```json\n" + JSON.stringify(value, null, 2) + "\n```";
  return escapeMarkdown(value);
}

// Renders a parsed JSON payload as a readable Markdown list. Objects become
// `key: value` bullets, arrays become bullets, and scalars render inline.
export function renderPayloadMarkdown(payload) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return "_empty list_";
    return payload.map((item) => `- ${renderInline(item)}`).join("\n");
  }
  if (payload && typeof payload === "object") {
    const keys = Object.keys(payload);
    if (keys.length === 0) return "_empty object_";
    return keys.map((key) => `- **${escapeMarkdown(key)}**: ${renderInline(payload[key])}`).join("\n");
  }
  return renderInline(payload);
}

// Formats a `crew-message` custom message as Markdown. Falls back to the original
// content verbatim whenever the payload is missing, truncated, or not valid JSON.
export function renderCrewMessageMarkdown(message) {
  const content = typeof message?.content === "string" ? message.content : "";
  if (!content) return "_(no content)_";
  const { header, payloadText } = splitPayload(content);
  if (payloadText == null) return content;
  const trimmed = payloadText.trim();
  if (!trimmed || trimmed.endsWith("[truncated]")) return content;
  const parsed = parseJson(trimmed);
  if (!parsed.ok) return content;
  return `${header}\n\n${renderPayloadMarkdown(parsed.value)}`;
}
