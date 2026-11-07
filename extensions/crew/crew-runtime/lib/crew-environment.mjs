import { preflightWorkerSandbox } from "../../env-runtime/lib/sandbox-preflight.mjs";

const validMicrovms = new Set(["auto", "gondolin"]);

export function crewEnvironment(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unsupported Crew microVM environment.");
  const microvm = value.microvm ?? "auto";
  const repository = value.repository;
  if (!validMicrovms.has(microvm)) throw new Error(`Unsupported Crew microVM environment: ${microvm}`);
  if (
    repository &&
    (typeof repository !== "object" ||
      !/^[^/\s]+\/[^/\s]+$/.test(repository.repo ?? "") ||
      !/^[0-9a-f]{40}$/i.test(repository.revision ?? "") ||
      typeof repository.base !== "string" ||
      !repository.base)
  )
    throw new Error("Unsupported Crew repository environment.");
  return { microvm, ...(repository ? { repository } : {}) };
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
