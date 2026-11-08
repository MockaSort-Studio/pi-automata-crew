export function verificationFacts(sources, bashGranted) {
  if (!bashGranted) return "Verification prerequisites: bash is not granted. Project dependency-backed tests require hosted CI; do not report them as passed.";
  const root = "/opt/crew/dependency-sources";
  const available = sources?.available ?? [];
  return [
    "Verification prerequisites: bash runs in the guest; individual tools and project dependencies are not guaranteed.",
    `Verified public dependency source snapshots: ${available.length ? available.join(", ") : "none"}; manifest at ${root}/manifest.json.`,
    ...(sources?.failures ?? []),
    available.includes("prettier")
      ? `Guest formatter: node ${root}/prettier/bin/prettier.cjs --write <workspace paths>.`
      : "Guest formatter unavailable; do not substitute a host formatter.",
    "Source snapshots are not installed project dependencies. Run syntax or focused tests only when their prerequisites are actually present; project dependency-backed tests require hosted CI when absent. Label guest, host, CI, and unperformed evidence separately.",
  ].join("\n");
}
