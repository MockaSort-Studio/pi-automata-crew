import assert from "node:assert/strict";
import test from "node:test";
import { credentialPolicyForSuites } from "../../.pi/extensions/hall-crew/env-runtime/credential-policy.mjs";
import { workerArmoryConfig } from "../../.pi/extensions/hall-crew/env-runtime/lib/worker-armory-config.mjs";

const path = "/nix/store/0123456789abcdefghijklmnopqrstuv-github";

test("worker Armory config exposes only exact mount paths and grants", () => {
  assert.deepEqual(workerArmoryConfig({ armory: { nixPaths: [path], suites: [{ rootPath: path, tools: ["github_issue_view"] }] } }), {
    paths: [path], suites: [{ rootPath: path, tools: ["github_issue_view"] }], network: undefined,
  });
});

test("worker Armory config rejects a broad Nix mount", () => {
  assert.throws(() => workerArmoryConfig({ armory: { nixPaths: ["/nix/store"], suites: [] } }), /invalid Nix mount/);
});

test("the credential policy a worker writes is accepted by the validator that reads it", () => {
  const network = { credentials: credentialPolicyForSuites(["collaboration/pi-github-tools"]) };
  assert.ok(network.credentials.length > 0);
  const config = workerArmoryConfig({ armory: { nixPaths: [path], suites: [{ rootPath: path, tools: ["github_issue_view"] }], network } });
  assert.deepEqual(config.network.credentials.map((credential) => credential.environment), ["GITHUB_TOKEN"]);
});

test("malformed credential bindings are still rejected", () => {
  const armory = (network) => ({ armory: { nixPaths: [path], suites: [{ rootPath: path, tools: ["t"] }], network } });
  assert.throws(() => workerArmoryConfig(armory({ credentials: "x" })), /invalid network policy/);
  assert.throws(() => workerArmoryConfig(armory({ credentials: [{ environment: "", hosts: [] }] })), /invalid network policy/);
  assert.throws(() => workerArmoryConfig(armory({ credentials: [{ environment: "GITHUB_TOKEN" }] })), /invalid network policy/);
});
