import assert from "node:assert/strict";
import test from "node:test";
import { createGuestNetwork } from "../../extensions/crew/env-runtime/lib/guest-network.mjs";

const externalRequest = (hostname) => ({
  hostname,
  ip: "93.184.216.34",
  family: 4,
  port: 443,
  protocol: "https",
});

test("an explicit empty host policy denies all guest egress", async () => {
  const { httpHooks } = createGuestNetwork({ allowedHosts: [] });
  assert.equal(await httpHooks.isIpAllowed(externalRequest("example.com")), false);
});

test("a suite host allowlist permits only the granted host", async () => {
  const { httpHooks } = createGuestNetwork({ allowedHosts: ["api.github.com"] });
  assert.equal(await httpHooks.isIpAllowed(externalRequest("api.github.com")), true);
  assert.equal(await httpHooks.isIpAllowed(externalRequest("example.com")), false);
});

test("a credential does not widen the guest host allowlist", async () => {
  const { httpHooks } = createGuestNetwork({
    allowedHosts: ["api.github.com"],
    secrets: { GITHUB_TOKEN: { value: "secret", hosts: ["api.github.com"] } },
  });
  assert.equal(await httpHooks.isIpAllowed(externalRequest("api.github.com")), true);
  assert.equal(await httpHooks.isIpAllowed(externalRequest("example.com")), false);
});

test("a denied host is recorded once without request content", async () => {
  const denied = [];
  const { httpHooks } = createGuestNetwork({ allowedHosts: [], onDenied: (host) => denied.push(host) });
  await httpHooks.isIpAllowed(externalRequest("example.com"));
  await httpHooks.isIpAllowed(externalRequest("example.com"));
  assert.deepEqual(denied, ["example.com"]);
});
