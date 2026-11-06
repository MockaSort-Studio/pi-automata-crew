import assert from "node:assert/strict";
import test from "node:test";
import { renderCrewMessageMarkdown, renderPayloadMarkdown } from "../../extensions/crew/crew/lib/crew-message-view.mjs";

test("renders an object payload as a readable bullet list", () => {
  const message = {
    content:
      'Crew message (request) from developer-snowball-00. Reply required.\nUntrusted payload:\n{"status":"ok","count":3}',
  };
  const text = renderCrewMessageMarkdown(message);
  assert.match(text, /Crew message \(request\) from developer-snowball-00/);
  assert.match(text, /\*\*status\*\*: ok/);
  assert.match(text, /\*\*count\*\*: 3/);
  assert.doesNotMatch(text, /\{"status":"ok"/, "the raw JSON blob should not survive untouched");
});

test("renders an array payload as bullets", () => {
  const data = renderPayloadMarkdown(["a", "b"]);
  assert.equal(data, "- a\n- b");
});

test("renders nested objects as a fenced JSON block inline", () => {
  const data = renderPayloadMarkdown({ nested: { a: 1 } });
  assert.match(data, /\*\*nested\*\*: *\n\n```json/);
});

test("falls back to the original text for non-JSON payloads", () => {
  const message = { content: "Crew message (note) from bollo.\nUntrusted payload:\nnot json at all" };
  assert.equal(renderCrewMessageMarkdown(message), message.content);
});

test("falls back to the original text for truncated payloads", () => {
  const message = {
    content: 'Crew message (note) from bollo.\nUntrusted payload:\n{"a":1… [truncated]',
  };
  assert.equal(renderCrewMessageMarkdown(message), message.content);
});

test("falls back to the original text when there is no payload marker", () => {
  const message = { content: "plain acknowledgement" };
  assert.equal(renderCrewMessageMarkdown(message), "plain acknowledgement");
});

test("handles missing or non-string content safely", () => {
  assert.equal(renderCrewMessageMarkdown({}), "_(no content)_");
  assert.equal(renderCrewMessageMarkdown(undefined), "_(no content)_");
});

test("escapes markdown-significant characters in scalar values", () => {
  const data = renderPayloadMarkdown({ note: "*bold* and _italic_" });
  assert.match(data, /\\\*bold\\\* and \\_italic\\_/);
});

test("a shortened report renders collapsed for the model's view and in full when expanded (Ctrl+O)", async () => {
  const { mainDeliveryMessage } = await import("../../extensions/crew/crew-runtime/lib/main-delivery-notifier.mjs");
  const diff = "line\n".repeat(4000);
  const message = mainDeliveryMessage({
    id: "m1",
    from: "crew-11111111-1111-1111-1111-111111111111-developer-snowball-00",
    kind: "notify",
    payload: { status: "complete", diff },
  });
  const collapsed = renderCrewMessageMarkdown(message);
  assert.match(collapsed, /\*\*status\*\*: complete/);
  assert.match(collapsed, /\d+ more chars/);
  assert.ok(collapsed.split("\n").length < 20, "the collapsed card stays compact");
  const expanded = renderCrewMessageMarkdown(message, { expanded: true });
  assert.ok(expanded.includes(diff.trimEnd().slice(-200)));
  assert.doesNotMatch(expanded, /truncated \d+ chars/);
  const short = mainDeliveryMessage({ id: "m2", from: "x", kind: "notify", payload: { ok: true } });
  assert.equal(short.details.payload, undefined);
  assert.equal(renderCrewMessageMarkdown(short, { expanded: true }), renderCrewMessageMarkdown(short));
});
