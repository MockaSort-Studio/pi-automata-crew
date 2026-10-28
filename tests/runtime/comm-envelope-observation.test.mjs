import { strict as assert } from "node:assert";
import test from "node:test";
import { projectEnvelope } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-envelope-observation.mjs";

const envelope = (payload) => ({ id: "e1", kind: "notify", from: "a", to: "b", replyTo: null, payload });

test("projects a JSON-encoded payload string by extracting its message field", () => {
  const projected = projectEnvelope(envelope(JSON.stringify({ message: "hello from json" })));
  assert.equal(projected.message, "hello from json");
});

test("projects a JSON-encoded payload string by extracting its summary field", () => {
  const projected = projectEnvelope(envelope(JSON.stringify({ summary: "summary text" })));
  assert.equal(projected.message, "summary text");
});

test("projects a JSON-encoded payload string by extracting its report field", () => {
  const projected = projectEnvelope(envelope(JSON.stringify({ report: "report text" })));
  assert.equal(projected.message, "report text");
});

test("falls back to the raw trimmed string when it is not JSON", () => {
  const projected = projectEnvelope(envelope("  plain text message  "));
  assert.equal(projected.message, "plain text message");
});

test("falls back to the raw trimmed string when it looks like JSON but is malformed", () => {
  const projected = projectEnvelope(envelope('{message: "unquoted key"}'));
  assert.equal(projected.message, '{message: "unquoted key"}');
});
