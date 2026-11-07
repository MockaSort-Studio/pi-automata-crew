import { Type } from "typebox";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: value,
});

// What Main can do with a running crew besides starting it: look, answer, cancel, clean up. Reports arrive as
// messages (crew-reports.mjs); none of these tools is for polling.
export function registerCrewHostTools(pi: any, host: (ctx: any) => any) {
  pi.registerTool({
    name: "crew_status",
    label: "Crew: status",
    description:
      "Show each member's state (queued, running, needs_input, held, completed, failed, cancelled) and its last activity. For a deliberate check, not for waiting: reports arrive as messages.",
    parameters: Type.Object({ runId: Type.Optional(Type.String()) }),
    async execute(_id: string, input: { runId?: string }, _signal: unknown, _update: unknown, ctx: any) {
      const { client, runs } = host(ctx);
      const ids = input.runId ? [input.runId] : runs();
      return text(await Promise.all(ids.map((runId: string) => client().request("status", { runId }))));
    },
  });

  pi.registerTool({
    name: "crew_message",
    label: "Crew: message a member",
    description:
      "Send a member a message in its existing conversation: the answer to a question it asked, a retry for a failed member, or a follow-up for a completed one.",
    parameters: Type.Object({ runId: Type.String(), member: Type.String(), text: Type.String({ minLength: 1 }) }),
    async execute(
      _id: string,
      input: { runId: string; member: string; text: string },
      _s: unknown,
      _u: unknown,
      ctx: any,
    ) {
      return text(
        await host(ctx).client().request("message", { runId: input.runId, handle: input.member, text: input.text }),
      );
    },
  });

  pi.registerTool({
    name: "crew_cancel",
    label: "Crew: cancel",
    description:
      "Cancel one member, or the whole crew when no member is named. Running work is aborted, including the commands in its VM, and its unsaved work is salvaged to its branch.",
    parameters: Type.Object({ runId: Type.String(), member: Type.Optional(Type.String()) }),
    async execute(_id: string, input: { runId: string; member?: string }, _s: unknown, _u: unknown, ctx: any) {
      return text(await host(ctx).client().request("cancel", { runId: input.runId, handle: input.member }));
    },
  });

  pi.registerTool({
    name: "runtime_cleanup",
    label: "Crew: clean up",
    description: "Cancel and dispose every crew started from this session, closing their VMs.",
    parameters: Type.Object({}),
    async execute(_id: string, _input: unknown, _signal: unknown, _update: unknown, ctx: any) {
      const crew = host(ctx);
      const disposed = [];
      for (const runId of crew.runs()) {
        await crew.client().request("dispose", { runId });
        crew.untrack(runId);
        disposed.push(runId);
      }
      return text({ disposed });
    },
  });

  pi.registerTool({
    name: "runtime_dispatch",
    label: "Crew: dispatch (compatibility)",
    description: "No longer needed: start_crew dispatches every member's assignment as soon as it launches.",
    parameters: Type.Object({ runId: Type.Optional(Type.String()), idempotencyKey: Type.Optional(Type.String()) }),
    async execute() {
      return text({ dispatched: true, note: "start_crew already dispatched the assignments." });
    },
  });
}
