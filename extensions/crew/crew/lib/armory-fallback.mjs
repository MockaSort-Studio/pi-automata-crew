// Armory guest suites must be realizable before a Gondolin Crew launches.
// There is no host fallback: unavailable guest capabilities are an actionable
// launch failure rather than an isolation or authority downgrade.
export async function realizeOrFallback(resolution, _microvm, realize) {
  if (!resolution.sandbox) throw new Error("Gondolin sandbox is required for Crew workers");
  await realize();
  return resolution;
}
