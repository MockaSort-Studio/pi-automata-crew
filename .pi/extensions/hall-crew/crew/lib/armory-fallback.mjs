// Armory guest suites must be realizable before a Gondolin Crew launches.
// `auto` degrades to the host with the reason; explicit `gondolin` reports it.
export async function realizeOrFallback(resolution, microvm, realize) {
  if (!resolution.sandbox) return resolution;
  try {
    await realize();
    return resolution;
  } catch (error) {
    if (microvm === "gondolin") throw error;
    const lines = [error?.stderr, error?.message].flatMap((text) => String(text ?? "").split("\n"));
    const reason = (
      lines.find((line) => /Reason:/.test(line)) ??
      lines.find((line) => /^error:/.test(line.trim())) ??
      lines.find((line) => line.trim()) ??
      "unknown"
    ).trim();
    return { microvm: "none", fallbackReason: `Armory guest suites unavailable: ${reason}` };
  }
}
