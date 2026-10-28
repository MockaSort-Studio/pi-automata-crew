import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveModelWindow } from "../../.pi/extensions/hall-crew/crew-runtime/lib/model-window.mjs";

test("resolves a known model id to its context window", () => {
  assert.equal(resolveModelWindow("claude-sonnet-4-6"), 200_000);
});

test("resolves a provider-namespaced model id by its trailing segment", () => {
  assert.equal(resolveModelWindow("anthropic/claude-sonnet-4-6"), 200_000);
});

test("returns null for an unknown model id instead of guessing", () => {
  assert.equal(resolveModelWindow("some-future-model"), null);
});

test("returns null for missing or non-string model ids", () => {
  assert.equal(resolveModelWindow(undefined), null);
  assert.equal(resolveModelWindow(""), null);
  assert.equal(resolveModelWindow(42), null);
});
