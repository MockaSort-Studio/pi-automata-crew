import { strict as assert } from "node:assert";
import test from "node:test";
import { armoryRoot, armoryRootsDir, explainMissingCache, guestNixSystem } from "../../.pi/extensions/hall-crew/env-runtime/lib/armory-nix.mjs";
import { armoryCache } from "../../.pi/extensions/hall-crew/env-runtime/lib/armory-artifacts.mjs";

test("roots are keyed by suite and system, never by revision, so a new revision replaces the old root", () => {
  const root = armoryRoot("collaboration/pi-github-tools", "aarch64-linux", "/home/u");
  assert.equal(root, "/home/u/.cache/hall/armory/roots/collaboration_pi-github-tools-aarch64-linux");
  assert.equal(armoryRootsDir("/home/u"), "/home/u/.cache/hall/armory/roots");
});

test("the cache identity is one pinned substituter and signing key", () => {
  assert.match(armoryCache.substituter, /^https:\/\/hall-armory\.cachix\.org$/);
  assert.match(armoryCache.publicKey, /^hall-armory\.cachix\.org-1:/);
});

test("a missing cache turns an opaque Nix failure into an actionable reason", async () => {
  const nixError = Object.assign(new Error("Command failed: nix build"), { stderr: "error: x\n  Reason: platform mismatch\n" });
  const explained = await explainMissingCache(nixError, { configured: async () => false });
  assert.match(explained.message, /Armory cache not configured \(run scripts\/setup-env\.sh\); Reason: platform mismatch/);
});

test("with the cache configured the original error passes through", async () => {
  const error = new Error("boom");
  assert.equal(await explainMissingCache(error, { configured: async () => true }), error);
});

test("if configuration cannot be read, the original error is kept", async () => {
  const error = new Error("boom");
  assert.equal(await explainMissingCache(error, { configured: async () => Promise.reject(new Error("no nix")) }), error);
});

test("the guest system follows the host architecture", () => {
  assert.equal(guestNixSystem("arm64"), "aarch64-linux");
  assert.equal(guestNixSystem("x64"), "x86_64-linux");
});
