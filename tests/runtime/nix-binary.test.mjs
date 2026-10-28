import { strict as assert } from "node:assert";
import test from "node:test";
import { nixBinary } from "../../.pi/extensions/hall-crew/env-runtime/lib/armory-nix.mjs";

const profile = "/nix/var/nix/profiles/default/bin/nix";

test("prefers nix on PATH", () => {
  assert.equal(nixBinary({ onPath: () => true, exists: () => assert.fail("not needed") }), "nix");
});

test("falls back to the standard install location when PATH lacks nix", () => {
  assert.equal(nixBinary({ onPath: () => false, exists: (path) => path === profile }), profile);
});

test("reports plain nix when it is nowhere, so the caller's preflight can explain", () => {
  assert.equal(nixBinary({ onPath: () => false, exists: () => false }), "nix");
});
