// Assembly authority is recorded unchanged in the launch config. The host may warn and narrow the default GitHub grant when its token is absent.
import { readFileSync } from "node:fs";
import { suiteGrants } from "./suite-grants.mjs";
import { NATIVE_TOOLS as native } from "./required-capabilities.mjs";

const roles = JSON.parse(readFileSync(new URL("../prompts/roles.json", import.meta.url), "utf8"));
const github = "collaboration/pi-github-tools";
export function validateMemberAuthority(automaton, role, requested) {
  const policy = roles[role];
  if (!policy) throw new Error(`Unknown role "${role}".`);
  const system = new Set();
  const operations = new Set();
  // The declarations are the authority: a role's tools plus the tools its persona declares. Native tools are
  // system operations; every other name is an Armory operation, resolved when the crew is launched.
  for (const tool of [...policy.tools, ...automaton.tools]) {
    if (native.has(tool)) system.add(tool);
    else operations.add(tool);
  }
  // A role's optional tools are granted only when an assignment asks for them by name.
  const optional = new Set(policy.optionalTools ?? []);
  const defaultOperations = [...operations].filter((tool) => !optional.has(tool));
  const defaults = [
    ...(system.size ? [{ suite: "system", operations: [...system] }] : []),
    ...(defaultOperations.length ? [{ suite: github, operations: defaultOperations }] : []),
  ];
  const grants = suiteGrants(requested === undefined ? defaults : requested);
  for (const tool of grants.system ?? []) {
    if (!system.has(tool))
      throw new Error(`Crew assignment has a system operation outside ${role}'s capabilities: ${tool}.`);
  }
  for (const grant of grants.suites) {
    if (grant.suite !== github) throw new Error(`Unknown or unauthorized Crew suite: ${grant.suite}.`);
    for (const tool of grant.tools)
      if (!operations.has(tool))
        throw new Error(`Crew assignment has an Armory operation outside ${role}'s capabilities: ${tool}.`);
  }
  return { tools: grants.system ?? [], suiteGrants: grants.suites };
}
