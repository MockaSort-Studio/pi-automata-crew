import { GITHUB_BASE_TOOL_SET } from "./github-base-tools.mjs";
import { repositoryTargets } from "../../env-runtime/lib/repository-targets.mjs";

export const NATIVE_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
const github = "collaboration/pi-github-tools";

// Assertions about authorization only: a grant does not guarantee installed tools or dependencies.
export function validateRequiredCapabilities({ member, requiredCapabilities, tools = [], suiteGrants = [], allowed }) {
  if (requiredCapabilities === undefined) return;
  if (!Array.isArray(requiredCapabilities)) throw new Error(`${member}: requiredCapabilities must be an array`);
  for (const requirement of requiredCapabilities) {
    if (
      !requirement ||
      typeof requirement.suite !== "string" ||
      !requirement.suite ||
      !Array.isArray(requirement.operations) ||
      !requirement.operations.length ||
      requirement.operations.some((operation) => typeof operation !== "string" || !operation)
    )
      throw new Error(`${member}: each required capability needs a suite and non-empty operations`);
    const { suite, operations } = requirement;
    for (const operation of operations) {
      const prefix = `${member}: ${suite} ${operation}`;
      if (!(suite === "system" ? NATIVE_TOOLS.has(operation) : suite === github && GITHUB_BASE_TOOL_SET.has(operation) && repositoryTargets[operation] !== "deferred"))
        throw new Error(`${prefix}: unsupported suite or operation`);
      if (allowed && !allowed(suite, operation)) throw new Error(`${prefix}: role-ceiling denial`);
      const granted =
        suite === "system"
          ? tools
          : suiteGrants.flatMap((grant) => (grant.suite === suite ? (grant.operations ?? grant.tools ?? []) : []));
      if (!granted.includes(operation)) throw new Error(`${prefix}: missing grant`);
    }
  }
}
