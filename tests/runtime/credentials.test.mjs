import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { credentialPolicyForSuites } from "../../.pi/extensions/hall-crew/env-runtime/credential-policy.mjs";
import {
  checkLaunchCredentials,
  consumeCredentialLease,
  leaseFromEnvironment,
  revokeCredentialLease,
  serializeLease,
} from "../../.pi/extensions/hall-crew/env-runtime/lib/credentials.mjs";

const github = ["collaboration/pi-github-tools"];
const bindings = credentialPolicyForSuites(github);

test("consumes and revokes a credential lease from a private descriptor", () => {
  const path = join(tmpdir(), `credential-lease-${process.pid}`);
  writeFileSync(path, JSON.stringify({ id: "lease", credentials: { GITHUB_TOKEN: { value: "secret", hosts: ["api.github.com"] } } }));
  const fd = openSync(path, "r");
  try {
    const lease = consumeCredentialLease(fd);
    assert.equal(lease.credentials.get("GITHUB_TOKEN").value, "secret");
    revokeCredentialLease(lease);
    assert.equal(lease.credentials.size, 0);
  } finally { rmSync(path, { force: true }); }
});

test("standalone use, with no descriptor 3, is tolerated on every platform (ENXIO on macOS)", () => {
  const module = new URL("../../.pi/extensions/hall-crew/env-runtime/lib/credentials.mjs", import.meta.url).href;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `import { consumeCredentialLease } from "${module}"; const l = consumeCredentialLease(); console.log(JSON.stringify({ id: l.id ?? null, size: l.credentials.size }));`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.deepEqual(JSON.parse(output), { id: null, size: 0 });
});


test("the dedicated Hall variable satisfies the binding", () => {
  assert.deepEqual(checkLaunchCredentials({ suiteIds: github, environment: { HALL_GITHUB_TOKEN: "x" } }), {
    status: { HALL_GITHUB_TOKEN: "environment" },
    warnings: [],
  });
});

test("an unrelated GITHUB_TOKEN is never taken, so it cannot leak to workers by accident", () => {
  const result = checkLaunchCredentials({ suiteIds: github, environment: { GITHUB_TOKEN: "broad-token-for-other-tools" } });
  assert.equal(result.status.HALL_GITHUB_TOKEN, "missing");
});

test("a missing token is a warning that says how to create and store one", () => {
  const { status, warnings } = checkLaunchCredentials({ suiteIds: github, environment: {} });
  assert.equal(status.HALL_GITHUB_TOKEN, "missing");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HALL_GITHUB_TOKEN is not set/);
  assert.match(warnings[0], /https:\/\/github\.com\/settings\/personal-access-tokens\/new/);
  assert.match(warnings[0], /fine-grained/);
  assert.match(warnings[0], /scripts\/setup-github-token\.sh/);
});

test("suites with no credential need nothing", () => {
  assert.deepEqual(checkLaunchCredentials({ suiteIds: [], environment: {} }), { status: {}, warnings: [] });
});

test("the guest still sees GITHUB_TOKEN while the host source is the Hall variable", () => {
  const [binding] = credentialPolicyForSuites(github);
  assert.equal(binding.guestEnvironment, "GITHUB_TOKEN");
  assert.equal(binding.environment, "GITHUB_TOKEN");
  assert.equal(binding.source, "environment:HALL_GITHUB_TOKEN");
});

test("the worker parent leases the credential from the environment and removes the variable", () => {
  const env = { HALL_GITHUB_TOKEN: "secret", OTHER: "unrelated" };
  const lease = leaseFromEnvironment(bindings, env);
  assert.equal(lease.credentials.get("GITHUB_TOKEN").value, "secret");
  assert.deepEqual(lease.credentials.get("GITHUB_TOKEN").hosts, ["api.github.com", "github.com"]);
  assert.equal(env.HALL_GITHUB_TOKEN, undefined, "Pi and its tools must not inherit the variable");
  assert.equal(env.OTHER, "unrelated");
});

test("a missing variable leases nothing, and an unknown source is refused", () => {
  assert.equal(leaseFromEnvironment(bindings, {}).credentials.size, 0);
  assert.throws(() => leaseFromEnvironment([{ source: "keychain:x", guestEnvironment: "T", hosts: [] }], {}), /Unknown credential source/);
});

test("a lease survives the descriptor channel and can be revoked afterwards (the worker's exit path)", () => {
  const lease = leaseFromEnvironment(bindings, { HALL_GITHUB_TOKEN: "secret" });
  const path = join(tmpdir(), `credentials-roundtrip-${process.pid}`);
  writeFileSync(path, serializeLease(lease));
  const fd = openSync(path, "r");
  try {
    const consumed = consumeCredentialLease(fd);
    assert.equal(consumed.id, lease.id);
    assert.equal(consumed.credentials.get("GITHUB_TOKEN").value, "secret");
    revokeCredentialLease(lease);
    assert.equal(lease.credentials.size, 0);
  } finally {
    rmSync(path, { force: true });
  }
});
