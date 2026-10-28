import { strict as assert } from "node:assert";
import test from "node:test";
import { credentialPolicyForSuites } from "../../.pi/extensions/hall-crew/env-runtime/credential-policy.mjs";

test("host policy binds GitHub credentials without granting unknown suites", () => {
  const [binding] = credentialPolicyForSuites(["collaboration/pi-github-tools", "unknown/suite"]);
  assert.equal(binding.guestEnvironment, "GITHUB_TOKEN");
  assert.deepEqual(binding.hosts, ["api.github.com", "github.com"]);
  assert.deepEqual(credentialPolicyForSuites(["unknown/suite"]), []);
});
