// Crew state lives under an explicit, caller-owned cwd only. There is no
// environment-variable-based host discovery: a worker (or any other
// caller) must be handed its owned root directly, never resolve one
// implicitly from ambient process state. See docs/crew/follow-ups.md.
export function crewRoot(cwd) {
  if (!cwd || typeof cwd !== "string") throw new Error("Crew root requires an explicit owned cwd");
  return cwd;
}

// Run IDs are interpolated into filesystem paths. Reject anything that
// isn't a plain identifier segment so a crafted runId (e.g. containing
// "../" or an absolute path) can never escape the owned crew-launch
// directory into host or cross-run state. Fail closed, not permissive.
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

export function assertOwnedRunId(runId) {
  if (!RUN_ID.test(String(runId ?? ""))) throw new Error(`Refusing cross-run/host state access for runId "${runId}"`);
  return runId;
}
