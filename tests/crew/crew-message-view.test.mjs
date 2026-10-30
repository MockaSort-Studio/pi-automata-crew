import assert from "node:assert/strict";
import test from "node:test";
import {
  renderCrewMessageMarkdown,
  renderPayloadMarkdown,
} from "../../.pi/extensions/hall-crew/crew/lib/crew-message-view.mjs";

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
