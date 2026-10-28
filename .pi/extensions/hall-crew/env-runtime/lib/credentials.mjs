import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { credentialPolicyForSuites } from "../credential-policy.mjs";

// The life of a worker credential: checked at launch (Main), leased by the worker's
// parent from its environment, and consumed once by the Gondolin extension over a private
// descriptor. Only presence is ever recorded; a value never reaches a file or Pi's env.
const hostVariable = (binding) => binding.source.split(":", 2)[1];

// Hall never reads a login or keyring on its own: the token is minted deliberately and handed
// over through the environment, so a missing one is a warning that says how to create it.
export function checkLaunchCredentials({ suiteIds, environment = process.env }) {
  const status = {};
  const warnings = [];
  for (const binding of credentialPolicyForSuites(suiteIds)) {
    const name = hostVariable(binding);
    status[name] = environment[name] ? "environment" : "missing";
    if (!environment[name])
      warnings.push(
        `${name} is not set, so operations that need it will fail. Create ${binding.mint.advice} at ${binding.mint.url}, ` +
          `store it with scripts/setup-github-token.sh (or export ${name}), and restart Pi.`,
      );
  }
  return { status, warnings };
}

// Worker parent: lease each bound credential and remove the variable, so the Pi child and
// the tools it runs never inherit it.
export function leaseFromEnvironment(bindings, env = process.env) {
  const credentials = new Map();
  for (const binding of bindings) {
    const [kind, name] = binding.source.split(":", 2);
    if (kind !== "environment") throw new Error(`Unknown credential source: ${kind}`);
    const value = env[name];
    delete env[name];
    if (value) credentials.set(binding.guestEnvironment, { value, hosts: binding.hosts });
  }
  return { id: randomUUID(), credentials };
}

export const serializeLease = (lease) => JSON.stringify({ id: lease.id, credentials: Object.fromEntries(lease.credentials) });

export function consumeCredentialLease(fd = 3) {
  let lease;
  try {
    lease = JSON.parse(readFileSync(fd, "utf8"));
  } catch (error) {
    // Standalone Gondolin use has no worker credential descriptor. An unopened descriptor is
    // EBADF or EINVAL on Linux but ENXIO on macOS.
    if (["EBADF", "EINVAL", "ENXIO"].includes(error?.code)) return { id: undefined, credentials: new Map() };
    throw new Error("Invalid worker credential lease.");
  }
  if (!lease || typeof lease.id !== "string" || !lease.credentials || typeof lease.credentials !== "object")
    throw new Error("Invalid worker credential lease.");
  const credentials = new Map();
  for (const [name, entry] of Object.entries(lease.credentials)) {
    if (typeof entry?.value !== "string" || !Array.isArray(entry.hosts) || !entry.hosts.every((host) => typeof host === "string"))
      throw new Error("Invalid worker credential lease.");
    credentials.set(name, entry);
  }
  return { id: lease.id, credentials };
}

export const revokeCredentialLease = (lease) => lease.credentials.clear();
