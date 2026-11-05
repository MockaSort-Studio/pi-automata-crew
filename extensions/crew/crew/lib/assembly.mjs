import {
  createRobot,
  ROLE_NAMES,
  safetyModule,
  soulModule,
  roleModule,
  validateRoleTools,
  crewDisciplineModule,
} from "./automaton-body/lib/index.mjs";
import { getAutomaton } from "./roster.mjs";
import { assignmentContext } from "./assignment-context.mjs";
import { BASE_TOOLS_PROFILE } from "./base-tools-profile.mjs";

export function validateAvailableRoleTools(tools, role) {
  validateRoleTools(tools, role);
}

export function assemble(name, role, task, override = {}) {
  const automaton = getAutomaton(name);
  const assignment = String(task || "").trim();
  if (assignment.length > 4000) throw new Error("Crew assignment exceeds 4000 characters");
  if (!ROLE_NAMES.includes(role)) throw new Error(`Unknown role "${role}". Available: ${ROLE_NAMES.join(", ")}`);
  const body = createRobot({ id: `${role}-${name}`, name, role })
    .install(safetyModule)
    .install(soulModule, { persona: automaton.persona })
    .install(crewDisciplineModule)
    .install(roleModule, { role, override })
    .build();
  // System operations belong to a role/automaton capability set. Armory
  // operations are validated by their explicitly requested suite at launch.
  const baseSystem = BASE_TOOLS_PROFILE.find((grant) => grant.suite === "system")?.operations ?? [];
  const capabilities = [...new Set([...body.tools, ...automaton.tools, ...baseSystem])];
  const requested = override.systemOperations;
  if (requested !== undefined && (!Array.isArray(requested) || requested.some((tool) => !capabilities.includes(tool))))
    throw new Error(`Crew assignment has a system operation outside ${role}'s capabilities.`);
  const tools = requested === undefined ? capabilities : [...new Set(requested)];
  return {
    name: `${role}-${name}`,
    instructions: `${body.instructions}${automaton.tools.length ? `\n\n## ARMORY\nDeclared domain tools: ${automaton.tools.join(", ")}.` : ""}${assignment ? `\n\n## BOUNDED ASSIGNMENT\n${assignment}` : ""}${assignmentContext(override)}`,
    tools,
    commTools: body.commTools,
    ...(body.extensionPaths ? { extensionPaths: body.extensionPaths } : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.thinking ? { thinking: body.thinking } : {}),
  };
}
