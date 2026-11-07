const MAX_PAYLOAD_CHARS = 8000;

const shortenStrings = (value, limit) => {
  if (typeof value === "string")
    return value.length > limit ? `${value.slice(0, limit)}… [truncated ${value.length - limit} chars]` : value;
  if (Array.isArray(value)) return value.map((item) => shortenStrings(item, limit));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shortenStrings(item, limit)]));
  return value;
};

// A long report is shortened field by field, so the text stays valid JSON (and keeps rendering as Markdown)
// instead of being cut mid-structure. The caller keeps the full payload for Ctrl+O.
export function boundedPayload(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (text.length <= MAX_PAYLOAD_CHARS) return { text, shortened: false };
  if (payload && typeof payload === "object")
    for (let limit = 2000; limit >= 100; limit = Math.floor(limit / 2)) {
      const shortened = JSON.stringify(shortenStrings(payload, limit));
      if (shortened.length <= MAX_PAYLOAD_CHARS) return { text: shortened, shortened: true };
    }
  return { text: `${text.slice(0, MAX_PAYLOAD_CHARS)}… [truncated]`, shortened: true };
}
