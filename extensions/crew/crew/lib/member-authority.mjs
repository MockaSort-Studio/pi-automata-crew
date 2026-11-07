// Assembly authority is recorded unchanged in the launch config. The host may warn and narrow the default GitHub grant when its token is absent.
import { readFileSync } from "node:fs";
import { suiteGrants } from "./suite-grants.mjs";
import { GITHUB_BASE_TOOL_SET } from "./github-base-tools.mjs";

const roles = JSON.parse(readFileSync(new URL("../prompts/roles.json", import.meta.url), "utf8"));
const native = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
const github = "collaboration/pi-github-tools";
export function validateMemberAuthority(automaton, role, requested) {
  const policy = roles[role];
  if (!policy) throw new Error(`Unknown role "${role}".`);
  const system = new Set();
  const operations = new Set();
  for (const tool of [...policy.tools, ...automaton.tools]) {
    if (native.has(tool)) system.add(tool);
    else if (GITHUB_BASE_TOOL_SET.has(tool)) operations.add(tool);
    else throw new Error(`Unknown policy capability "${tool}".`);
  }
  const defaults = [
    ...(system.size ? [{ suite: "system", operations: [...system] }] : []),
    ...(operations.size ? [{ suite: github, operations: [...operations] }] : []),
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
