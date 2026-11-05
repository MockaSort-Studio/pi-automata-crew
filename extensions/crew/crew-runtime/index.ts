import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { Type } from "typebox";
import { registerCleanupTools } from "./lib/cleanup-tools.ts";
import { runtimeFor } from "./lib/shared-runtime.mjs";

const crewLaunchDir = (cwd: string) => join(cwd, CONFIG_DIR_NAME, "runtime", "crew-launch");

export default function runtimeExtension(pi: any): void {
  const runtime = runtimeFor(process.cwd());
  registerCleanupTools(pi, runtime, crewLaunchDir);
  pi.registerTool({
    name: "runtime_launch_crew",
    label: "Runtime: launch crew",
    description: "Start Comm and Lifecycle, register actors, and launch a Crew in one operation.",
    parameters: Type.Object({
      agents: Type.Array(
        Type.Object({
          name: Type.String(),
          task: Type.String(),
          actorId: Type.Optional(Type.String()),
          model: Type.Optional(Type.String()),
          thinking: Type.Optional(
            Type.Union([Type.Literal("off"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
          ),
          tools: Type.Optional(Type.Array(Type.String())),
          extensionPaths: Type.Optional(Type.Array(Type.String())),
          bundles: Type.Optional(Type.Array(Type.String())),
          resident: Type.Optional(Type.Boolean()),
        }),
      ),
    }),
    async execute(_id, input) {
      const result = await runtime.launchCrew(input.agents);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_spawn_agent",
    label: "Runtime: spawn agent",
    description: "Start one standalone SDK agent in a fresh Git worktree.",
    parameters: Type.Object({
      name: Type.String(),
      task: Type.String(),
      actorId: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(
        Type.Union([Type.Literal("off"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
      ),
      tools: Type.Optional(Type.Array(Type.String())),
      extensionPaths: Type.Optional(Type.Array(Type.String())),
      bundles: Type.Optional(Type.Array(Type.String())),
      resident: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, input) {
      const agent = await runtime.spawn(input);
      return { content: [{ type: "text", text: JSON.stringify(agent) }], details: agent };
    },
  });
  pi.registerTool({
    name: "runtime_list_agents",
    label: "Runtime: list agents",
    description: "List SDK agents started in this Main session.",
    parameters: Type.Object({}),
    async execute() {
      const agents = await runtime.list();
      return { content: [{ type: "text", text: JSON.stringify(agents) }], details: agents };
    },
  });
  pi.registerTool({
    name: "runtime_start_comm",
    label: "Runtime: start communication",
    description: "Start this Crew runtime communication controller.",
    parameters: Type.Object({ actors: Type.Optional(Type.Array(Type.String())) }),
    async execute(_id, input) {
      const result = await runtime.startComm(input.actors);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_send_message",
    label: "Runtime: send to member",
    description: "Send one opaque payload from Main to one exact Crew member handle.",
    parameters: Type.Object({ runId: Type.String(), to: Type.String(), payload: Type.Unknown() }),
    async execute(_id, input) {
      const result = await runtime.sendMember(input.runId, input.to, input.payload);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_send_all",
    label: "Runtime: send to Crew",
    description: "Send one opaque Main payload to every member of one Crew run.",
    parameters: Type.Object({ runId: Type.String(), payload: Type.Unknown() }),
    async execute(_id, input) {
      const result = await runtime.broadcastRun(input.runId, input.payload);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_dispatch",
    label: "Runtime: dispatch Crew roots",
    description: "Deliver immutable root assignments once after a Crew is ready.",
    parameters: Type.Object({ runId: Type.String(), idempotencyKey: Type.String() }),
    async execute(_id, input) {
      const result = await runtime.dispatchRoots(input.runId, input.idempotencyKey);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_request_member",
    label: "Runtime: request member",
    description: "Send a Main request to one member and retain its correlated reply in Main's inbox.",
    parameters: Type.Object({ runId: Type.String(), to: Type.String(), payload: Type.Unknown() }),
    async execute(_id, input) {
      const result = await runtime.request(input.runId, input.to, input.payload);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_reply_message",
    label: "Runtime: reply",
    description: "Reply once to a request delivered to Main and acknowledge that delivery.",
    parameters: Type.Object({ messageId: Type.String(), payload: Type.Unknown() }),
    async execute(_id, input) {
      const result = await runtime.replyFromMain(input.messageId, input.payload);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_acknowledge_message",
    label: "Runtime: acknowledge",
    description: "Acknowledge one non-request delivery received by Main.",
    parameters: Type.Object({ messageId: Type.String() }),
    async execute(_id, input) {
      const result = await runtime.acknowledgeMain(input.messageId);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_receive_message",
    label: "Runtime: receive message",
    description: "Claim one queued message for Main or a Crew actor.",
    parameters: Type.Object({ actorId: Type.Optional(Type.String()) }),
    async execute(_id, input) {
      const result = await runtime.receive(input.actorId);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_inspect_comm",
    label: "Runtime: inspect communication",
    description: "Return payload-free communication controller events.",
    parameters: Type.Object({}),
    async execute() {
      const result = await runtime.inspectComm();
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: "runtime_inspect_agent",
    label: "Runtime: inspect agent",
    description: "Return compact lifecycle and telemetry state for one SDK agent.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, input) {
      const result = await runtime.inspect(input.id);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
}
