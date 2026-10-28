// Host-owned bindings. Armory names a suite; it never selects a secret source
// or the destinations at which a secret may be substituted.
const policies = new Map([
  [
    "collaboration/pi-github-tools",
    [
      {
        slot: "github-api",
        // The guest sees GITHUB_TOKEN (what gh reads). The host variable is
        // Hall-specific so an unrelated GITHUB_TOKEN exported for other tools is
        // never handed to workers by accident.
        environment: "GITHUB_TOKEN",
        guestEnvironment: "GITHUB_TOKEN",
        hosts: ["api.github.com", "github.com"],
        source: "environment:HALL_GITHUB_TOKEN",
        mint: {
          url: "https://github.com/settings/personal-access-tokens/new",
          advice: "a fine-grained token limited to the repositories a Crew needs (read access to Issues, Pull requests, Contents and Metadata unless it must write)",
        },
      },
    ],
  ],
]);

export function credentialPolicyForSuites(suites) {
  const bindings = [];
  for (const suite of suites) bindings.push(...(policies.get(suite) ?? []));
  const names = new Set();
  for (const binding of bindings) {
    if (names.has(binding.guestEnvironment)) throw new Error(`Conflicting credential binding: ${binding.guestEnvironment}`);
    names.add(binding.guestEnvironment);
  }
  return bindings;
}
