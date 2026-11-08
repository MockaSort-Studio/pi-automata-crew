import {
  createRobot,
  ROLE_NAMES,
  safetyModule,
  soulModule,
  domainModule,
  roleModule,
  crewDisciplineModule,
} from "./automaton-body/lib/index.mjs";
import { getAutomaton } from "./roster.mjs";
import { assignmentContext } from "./assignment-context.mjs";
import { validateMemberAuthority } from "./member-authority.mjs";

export function assemble(name, role, task, override = {}) {
  const automaton = getAutomaton(name);
  const assignment = String(task || "").trim();
  if (assignment.length > 4000) throw new Error("Crew assignment exceeds 4000 characters");
  if (!ROLE_NAMES.includes(role)) throw new Error(`Unknown role "${role}". Available: ${ROLE_NAMES.join(", ")}`);
  const body = createRobot({ id: `${role}-${name}`, name, role })
    .install(safetyModule)
    .install(soulModule, { persona: automaton.persona })
    .install(domainModule, { discipline: automaton.discipline })
    .install(crewDisciplineModule)
    .install(roleModule, { role, override })
    .build();
  const requested =
    override.tools !== undefined
      ? override.tools
      : override.systemOperations === undefined
        ? undefined
        : [{ suite: "system", operations: override.systemOperations }];
  const authority = validateMemberAuthority(automaton, role, requested);
  return {
    name: `${role}-${name}`,
    instructions: `${body.instructions}${automaton.tools.length ? `\n\n## ARMORY\nDeclared domain tools: ${automaton.tools.join(", ")}.` : ""}${assignment ? `\n\n## BOUNDED ASSIGNMENT\n${assignment}` : ""}${assignmentContext(override)}`,
    ...authority,
    commTools: body.commTools,
    ...(body.extensionPaths ? { extensionPaths: body.extensionPaths } : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.thinking ? { thinking: body.thinking } : {}),
  };
}
