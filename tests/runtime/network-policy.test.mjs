import assert from "node:assert/strict";
import test from "node:test";
import { createHttpHooks } from "@earendil-works/gondolin";

const externalRequest = (hostname) => ({
  hostname,
  ip: "93.184.216.34",
  family: 4,
  port: 443,
  protocol: "https",
});

test("an explicit empty host policy denies all guest egress", async () => {
  const { httpHooks } = createHttpHooks({ allowedHosts: [] });
  assert.equal(await httpHooks.isIpAllowed(externalRequest("example.com")), false);
});

test("a suite host allowlist permits only the granted host", async () => {
  const { httpHooks } = createHttpHooks({ allowedHosts: ["api.github.com"] });
  assert.equal(await httpHooks.isIpAllowed(externalRequest("api.github.com")), true);
  assert.equal(await httpHooks.isIpAllowed(externalRequest("example.com")), false);
});

test("a credential does not widen the guest host allowlist", async () => {
  const { httpHooks } = createHttpHooks({
    allowedHosts: ["api.github.com"],
    secrets: { GITHUB_TOKEN: { value: "secret", hosts: ["api.github.com"] } },
  });
  assert.equal(await httpHooks.isIpAllowed(externalRequest("api.github.com")), true);
  assert.equal(await httpHooks.isIpAllowed(externalRequest("example.com")), false);
});
