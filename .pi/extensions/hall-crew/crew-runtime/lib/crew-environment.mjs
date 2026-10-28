import { preflightWorkerSandbox } from "../../env-runtime/lib/sandbox-preflight.mjs";

const validMicrovms = new Set(["auto", "gondolin", "none"]);

export function crewEnvironment(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unsupported Crew microVM environment.");
  const microvm = value.microvm ?? "auto";
  if (!validMicrovms.has(microvm)) throw new Error(`Unsupported Crew microVM environment: ${microvm}`);
  return { microvm };
}

export async function resolveCrewEnvironment(value, { preflight = preflightWorkerSandbox } = {}) {
  const environment = crewEnvironment(value);
  if (environment.microvm === "none") return environment;
  try {
    await preflight({ sandbox: { kind: "gondolin" } });
    return { microvm: "gondolin", sandbox: { kind: "gondolin" } };
  } catch (error) {
    if (environment.microvm === "gondolin") throw error;
    return { microvm: "none", fallbackReason: String(error.message ?? error) };
  }
}
