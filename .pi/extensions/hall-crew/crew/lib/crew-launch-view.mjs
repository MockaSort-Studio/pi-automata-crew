// Pure launch-result state keeps the visual policy testable without a terminal harness.
export function crewLaunchResultState(isPartial, details) {
  if (isPartial) return "launching";
  return details?.runId ? "hidden" : "failed";
}
