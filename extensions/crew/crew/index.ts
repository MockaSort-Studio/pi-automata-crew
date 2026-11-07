import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { assemble, validateAvailableRoleTools } from "./lib/assembly.mjs";
import { prepareCrew, queuedMessage } from "./lib/startup.mjs";
import { launchOnHost } from "./lib/host-launch.mjs";
import { bindCrewHost, crewHost } from "./lib/crew-host.mjs";
import { registerHostMonitor } from "./lib/host-monitor.ts";
import { registerCrewDoctor } from "./lib/crew-doctor.ts";
import { registerCrewHostTools } from "./lib/crew-host-tools.ts";
import { registerCrewObservability } from "./lib/observability.mjs";
import { registerSkillTrace } from "./lib/skill-trace.ts";
import { assemblyCardData } from "./lib/crew-assembly-card.mjs";
import { CREW_ASSEMBLED_ENTRY, registerCrewAssemblyCard } from "./lib/crew-assembly-card.ts";
import { registerCrewMessageRenderer } from "./lib/crew-message-renderer.ts";
import { parseSpecialistRoutes, routeSpecialists, specialistRoutesPath } from "./lib/specialist-routing.mjs";

const output = (value, text = JSON.stringify(value)) => ({
  content: [{ type: "text", text }],
  details: value,
});

const assignmentFields = {
  inputs: Type.Optional(Type.Array(Type.Object({ kind: Type.String() }, { additionalProperties: true }))),
  deliverTo: Type.Optional(Type.String()),
  authority: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Boolean()]))),
  acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
  tools: Type.Optional(
    Type.Array(Type.Object({ suite: Type.String(), operations: Type.Array(Type.String(), { minItems: 1 }) })),
  ),
  skills: Type.Optional(Type.Array(Type.String(), { maxItems: 4 })),
};
const initialMember = Type.Object({
  name: Type.String(),
  role: Type.String(),
  task: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  ...assignmentFields,
});
const parameters = Type.Object({
  members: Type.Array(initialMember, { minItems: 1 }),
  outputPath: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  completionMode: Type.Optional(Type.Literal("unattended")),
  monitorIntervalMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 604800000 })),
  resultSummaryMaxBytes: Type.Optional(Type.Integer({ minimum: 512, maximum: 50000 })),
  environment: Type.Optional(
    Type.Object({
      microvm: Type.Union([Type.Literal("auto"), Type.Literal("gondolin")]),
      dependencyCache: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("required")])),
      guestProfile: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      repository: Type.Optional(
        Type.Object({
          repo: Type.String(),
          revision: Type.String({ minLength: 40, maxLength: 40 }),
          base: Type.String(),
        }),
      ),
    }),
  ),
});

export default function crewExtension(pi: ExtensionAPI) {
  // Pi re-evaluates extensions on /reload; the host connection survives it and delivers through the current pi.
  bindCrewHost(pi);
  const host = (ctx: any) => crewHost({ cwd: ctx.cwd, configDir: CONFIG_DIR_NAME });
  registerCrewObservability(pi, CONFIG_DIR_NAME);
  registerSkillTrace(pi);
  registerCrewAssemblyCard(pi);
  registerCrewMessageRenderer(pi);
  registerCrewHostTools(pi, host);
  registerCrewDoctor(pi);
  const monitor = registerHostMonitor(pi, host);
  // Quitting stops the host, which closes every VM. A reload leaves running crews alone.
  pi.on("session_shutdown", async (event: any, ctx: any) => {
    if (event?.reason === "quit") await host(ctx).stop();
  });

  pi.registerTool({
    name: "crew_route",
    label: "Crew: route specialists",
    description: "Select specialist personas for repository paths using SPECIALIST_ROUTES. Does not select roles.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { minItems: 1 }),
      maxSpecialists: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
    }),
    async execute(_id, input, _signal, _update, ctx) {
      const source = readFileSync(specialistRoutesPath(ctx.cwd), "utf8");
      return output(routeSpecialists(input.paths, parseSpecialistRoutes(source), input.maxSpecialists));
    },
  });

  pi.registerTool({
    name: "build_crew_member",
    label: "Crew: build member",
    description: "Assemble a Hall soul and role with a bounded assignment.",
    parameters: Type.Object({
      name: Type.String(),
      role: Type.String(),
      task: Type.String(),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.String()),
      ...assignmentFields,
    }),
    async execute(_id, input) {
      const actor = assemble(input.name, input.role, input.task, { ...input, runtimeTools: pi.getAllTools() });
      validateAvailableRoleTools(actor.tools, input.role);
      return output(actor);
    },
  });

  pi.registerTool({
    name: "start_crew",
    label: "Crew: start",
    description:
      "Launch a Crew. Each member is a Pi session whose tools run in its own isolated Gondolin VM; assignments are dispatched immediately, in dependency order. Results arrive as messages: end your turn and wait.",
    parameters,
    renderCall(args, theme) {
      const label = `${args.members.length} member${args.members.length === 1 ? "" : "s"}`;
      return new Text(theme.fg("toolTitle", theme.bold("Crew ")) + theme.fg("muted", label), 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Launching SDK Crew..."), 0, 0);
      const details = result.details as { runId?: string; status?: string } | undefined;
      if (!details?.runId) return new Text(theme.fg("error", "Crew launch failed"), 0, 0);
      // Launch success is already shown by the TUI-only assembled-Crew card appended before
      // the runtime launch; a second "started" line here would be redundant.
      return new Container();
    },
    async execute(_id, input, signal, _update, ctx) {
      const THINKING_UNSUPPORTED = ["mistral-small", "mistral-medium", "mistral-tiny"];
      if (input.model) {
        const m = input.model.toLowerCase();
        if (THINKING_UNSUPPORTED.some((blocked) => m.includes(blocked))) {
          throw new Error(
            `Model "${input.model}" does not support thinking mode, which is required for the Crew Lead role.`,
          );
        }
      }
      const prepared = await prepareCrew(pi, input, { ...ctx, signal }, CONFIG_DIR_NAME);
      // This records the selected party even if runtime launch later fails. It is TUI-only, never a
      // sendMessage: it must not steer Main or enter model context.
      pi.appendEntry(CREW_ASSEMBLED_ENTRY, assemblyCardData(prepared, input));
      const launched = await launchOnHost({ host: host(ctx), prepared, cwd: ctx.cwd, configDir: CONFIG_DIR_NAME });
      monitor.activate(ctx);
      const warnings = launched.warnings?.length
        ? `\n\nWarnings:\n${launched.warnings.map((line: string) => `- ${line}`).join("\n")}`
        : "";
      return output({ ...prepared, ...launched, launchRequired: false }, `${queuedMessage(prepared)}${warnings}`);
    },
  });
}
