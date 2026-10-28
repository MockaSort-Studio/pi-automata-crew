import { strict as assert } from "node:assert";
import test from "node:test";
import { validateArmorySuite } from "../../.pi/extensions/hall-crew/env-runtime/lib/armory-manifest.mjs";

const manifest = () => ({
  format: "hall.armory-suite/v1",
  extension: "github",
  package: { name: "@mockasort-studio/pi-github-tools", version: "0.1.2", integrity: "sha512-test" },
  native: { closure: ".", output: "guest" },
  network: { allowedHosts: ["api.github.com"], credentials: [{ environment: "GITHUB_TOKEN", hosts: ["api.github.com"] }] },
  tools: ["github_issue_view", "github_pull_request_view"],
});

test("a requested subset narrows the suite's operations", () => {
  const suite = validateArmorySuite(manifest(), ["github_issue_view"]);
  assert.deepEqual(suite.tools, ["github_issue_view"]);
  assert.deepEqual(suite.native, { closure: ".", output: "guest" });
});

test("no request means the suite's whole declared allowlist", () => {
  assert.deepEqual(validateArmorySuite(manifest()).tools, ["github_issue_view", "github_pull_request_view"]);
});

test("an undeclared operation is refused", () => {
  assert.throws(() => validateArmorySuite(manifest(), ["github_repo_delete"]), /undeclared tools/);
});

test("a wrong format, a missing output, or a malformed tool list is refused", () => {
  assert.throws(() => validateArmorySuite({ ...manifest(), format: "other" }), /Unsupported Armory suite manifest format/);
  assert.throws(() => validateArmorySuite({ ...manifest(), native: { closure: "." } }), /native Nix output is required/);
  assert.throws(() => validateArmorySuite({ ...manifest(), tools: ["ok", ""] }), /invalid tool allowlist/);
});

test("a malformed network policy is refused", () => {
  assert.throws(() => validateArmorySuite({ ...manifest(), network: { allowedHosts: "api.github.com" } }), /network policy is invalid/);
  assert.throws(() => validateArmorySuite({ ...manifest(), network: { allowedHosts: [], credentials: [{ environment: "", hosts: [] }] } }), /credential policy is invalid/);
});
