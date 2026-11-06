import { preflightWorkerSandbox } from "../../env-runtime/lib/sandbox-preflight.mjs";

const validMicrovms = new Set(["auto", "gondolin"]);
const validDependencyCaches = new Set(["none", "required"]);
const DEFAULT_GUEST_PROFILE = "gondolin-alpine-node24";

export function crewEnvironment(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unsupported Crew microVM environment.");
  const microvm = value.microvm ?? "auto";
  const dependencyCache = value.dependencyCache ?? "none";
  const guestProfile = value.guestProfile ?? DEFAULT_GUEST_PROFILE;
  const repository = value.repository;
  if (!validMicrovms.has(microvm)) throw new Error(`Unsupported Crew microVM environment: ${microvm}`);
  if (!validDependencyCaches.has(dependencyCache))
    throw new Error(`Unsupported Crew dependency cache mode: ${dependencyCache}`);
  if (typeof guestProfile !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(guestProfile))
    throw new Error("Unsupported Crew guest profile.");
  if (
    repository &&
    (typeof repository !== "object" ||
      !/^[^/\s]+\/[^/\s]+$/.test(repository.repo ?? "") ||
      !/^[0-9a-f]{40}$/i.test(repository.revision ?? "") ||
      typeof repository.base !== "string" ||
      !repository.base)
  )
    throw new Error("Unsupported Crew repository environment.");
  return { microvm, dependencyCache, guestProfile, ...(repository ? { repository } : {}) };
}

export async function resolveCrewEnvironment(value, { preflight = preflightWorkerSandbox } = {}) {
  const environment = crewEnvironment(value);
  try {
    await preflight({ sandbox: { kind: "gondolin" } });
    return { microvm: "gondolin", sandbox: { kind: "gondolin" } };
  } catch (error) {
    throw new Error(`Gondolin sandbox is required for Crew workers: ${String(error.message ?? error)}`);
  }
}
