import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../.pi/extensions/hall-crew/crew/lib/crew-message-renderer.ts", import.meta.url),
  "utf8",
);

test("crew-message renderer registers against the crew-message customType", () => {
  assert.match(source, /registerMessageRenderer\("crew-message"/);
  assert.match(source, /buildCrewMessageChrome/);
});

test("crew-message renderer safely falls back to raw content on a render failure", () => {
  assert.match(source, /catch\s*\{/);
  assert.match(source, /message\?\.content/);
});
