import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { assemble, validateAvailableRoleTools } from "./lib/assembly.mjs";
import { registerCrewMonitor } from "./lib/monitor.ts";
import { launchPreparedCrew, prepareCrew, queuedMessage } from "./lib/startup.mjs";
import { registerCrewObservability } from "./lib/observability.mjs";
import { registerRosterTools } from "./lib/roster-tools.ts";
import { runtimeFor } from "../crew-runtime/lib/shared-runtime.mjs";
import { registerTerminalNotifierSession } from "./lib/terminal-notifier-session.mjs";
import { installCrewDispatchArming } from "./lib/dispatch-arming.mjs";

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
    Type.Array(
      Type.Object({ suite: Type.String(), operations: Type.Array(Type.String(), { minItems: 1 }) }),
    ),
  ),
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
  completionMode: Type.Optional(Type.Union([Type.Literal("unattended"), Type.Literal("human-gated")])),
  monitorIntervalMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 604800000 })),
  resultSummaryMaxBytes: Type.Optional(Type.Integer({ minimum: 512, maximum: 50000 })),
  environment: Type.Optional(
    Type.Object({
      microvm: Type.Union([Type.Literal("auto"), Type.Literal("gondolin"), Type.Literal("none")]),
    }),
  ),
});

export default function crewExtension(pi: ExtensionAPI) {
  const attachTerminalNotifier = registerTerminalNotifierSession(pi, runtimeFor);
  installCrewDispatchArming(pi);
  registerCrewObservability(pi, CONFIG_DIR_NAME);
  registerRosterTools(pi);
  const monitor = registerCrewMonitor(pi);

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
    description: "Launch a Crew on the SDK runtime with Comm and Lifecycle processes.",
    parameters,
    renderCall(args, theme) {
      const label = `${args.members.length} member${args.members.length === 1 ? "" : "s"}`;
      return new Text(theme.fg("toolTitle", theme.bold("Crew ")) + theme.fg("muted", label), 0, 0);
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Launching SDK Crew..."), 0, 0);
      const details = result.details as { runId?: string; status?: string } | undefined;
      if (!details?.runId) return new Text(theme.fg("error", "Crew launch failed"), 0, 0);
      return new Text(
        theme.fg("success", theme.bold("✓ SDK Crew started")) + theme.fg("muted", `  ${details.runId.slice(0, 8)}`),
        0,
        0,
      );
    },
    async execute(_id, input, signal, _update, ctx) {
      // Bind against this tool's actual Runtime before it launches a Crew.
      attachTerminalNotifier(ctx);
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
      monitor.activate(ctx, prepared.rosterFile);
      const launched = await launchPreparedCrew(ctx.cwd, prepared);
      const warnings = launched.warnings?.length ? `\n\nWarnings:\n${launched.warnings.map((line: string) => `- ${line}`).join("\n")}` : "";
      return output({ ...prepared, ...launched, launchRequired: false }, `${queuedMessage(prepared)}${warnings}`);
    },
  });
}
