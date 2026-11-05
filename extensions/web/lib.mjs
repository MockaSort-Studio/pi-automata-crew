// Minimal, dependency-free web fetch — Node 24+ native fetch, no MCP server.
// Part of our own tool taxonomy (web.fetch), not a literal port of Hall's
// existing mcp__fetch__fetch — same purpose, purpose-built for SDK workers.

const MAX_CHARS = 20000;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function webFetch(url, maxChars = MAX_CHARS) {
  const res = await fetch(url, { redirect: "follow" });
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  const text = contentType.includes("html") ? stripHtml(raw) : raw;
  const truncated = text.length > maxChars;
  return {
    url,
    status: res.status,
    contentType,
    text: truncated ? text.slice(0, maxChars) : text,
    truncated,
    totalChars: text.length,
  };
}
