import { strict as assert } from "node:assert";
import test from "node:test";
import { boundedPayload as earlier } from "../../extensions/crew/crew-runtime/lib/main-delivery-notifier.mjs";
import { boundedPayload } from "../../extensions/crew/crew/lib/bounded-payload.mjs";

test("a short report is untouched; a long one is shortened field by field and stays valid JSON", () => {
  assert.deepEqual(boundedPayload({ a: "ok" }), { text: '{"a":"ok"}', shortened: false });
  const long = boundedPayload({ finalText: "x".repeat(50_000), status: "completed" });
  assert.equal(long.shortened, true);
  assert.ok(long.text.length <= 8000);
  assert.equal(JSON.parse(long.text).status, "completed");
  assert.match(JSON.parse(long.text).finalText, /\[truncated \d+ chars\]$/);
});

test("it shortens exactly as the earlier runtime's copy does, so a report looks the same either way", () => {
  const inputs = [
    "plain",
    { a: 1 },
    { finalText: "y".repeat(9000) },
    { list: Array.from({ length: 200 }, (_, i) => `item ${i} ${"z".repeat(100)}`) },
    Array.from({ length: 4000 }, (_, i) => i),
  ];
  for (const input of inputs) assert.deepEqual(boundedPayload(input), earlier(input));
});
