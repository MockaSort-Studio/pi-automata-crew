// Validates a member's suite grants and splits them into system operations and Armory suites.
export const suiteGrants = (tools) => {
  if (tools === undefined) return { system: undefined, suites: [] };
  if (!Array.isArray(tools)) throw new Error("Crew tools must be suite grants.");
  const seen = new Set();
  for (const grant of tools) {
    if (!grant || typeof grant.suite !== "string" || !grant.suite || !Array.isArray(grant.operations) || !grant.operations.length)
      throw new Error("Crew suite grants require a suite and operations.");
    if (seen.has(grant.suite) || new Set(grant.operations).size !== grant.operations.length || grant.operations.some((item) => typeof item !== "string" || !item))
      throw new Error("Crew suite grants must be unique and non-empty.");
    seen.add(grant.suite);
  }
  return {
    system: tools.find((grant) => grant.suite === "system")?.operations,
    suites: tools.filter((grant) => grant.suite !== "system").map(({ suite, operations }) => ({ suite, tools: operations })),
  };
};
