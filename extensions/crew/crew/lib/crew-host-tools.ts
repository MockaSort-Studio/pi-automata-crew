import { Type } from "typebox";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: value,
});

// What Main can do with a running crew besides starting it: look, resume, hold, hand off, cancel, clean up.
// Reports arrive as messages (crew-reports.mjs); none of these tools is for polling. The lifecycle they act on
// is defined in runner/member-lifecycle.mjs.
export function registerCrewHostTools(pi: any, host: (ctx: any) => any) {
  pi.registerTool({
    name: "crew_status",
    label: "Crew: status",
    description:
      "Show each member's one current state (queued, held, running, ci = waiting for its pull request checks, needs_input, failed, on_hold, completed, handed_off, cancelled), its lastReport (the member's latest report with its time; current=false means the member has moved on since), its ci snapshot (state of an exact headSha at checkedAt; only success is green: none and unavailable are not), Main's hold or handoff (a hold's refs are Main-asserted, refsAssertedBy=main: recorded as given, not verified by the runner), and its last activity. completed means the model finished and the CI gate passed or found no checks; it is not review or acceptance. For a deliberate check, not for waiting: reports arrive as messages.",
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
      "Resume a member with one new turn in its existing conversation: an answer to its question, new evidence, a decision, a retry for a failed member, a follow-up for a completed one, or recovery of a handed-off one (in a new session). Every message resumes; to acknowledge without new evidence or a decision, use crew_hold instead.",
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
    name: "crew_hold",
    label: "Crew: hold a member",
    description:
      "Acknowledge a member that is waiting for you (needs_input, failed or on_hold) without starting a turn: record what blocks it, who owns the blocker, and what will make you resume it, with optional pull request, head SHA or artifact references (Main-asserted: recorded as you give them and labelled refsAssertedBy=main, never verified by the runner). The member stays on_hold with its VM and its dependents held. Nothing resumes it automatically: resume it later with crew_message.",
    parameters: Type.Object({
      runId: Type.String(),
      member: Type.String(),
      blocker: Type.String({ minLength: 1 }),
      owner: Type.String({ minLength: 1, description: "Who must act: a member handle, main or human" }),
      resumeWhen: Type.String({ minLength: 1 }),
      refs: Type.Optional(
        Type.Object({
          pullRequest: Type.Optional(Type.String()),
          head: Type.Optional(Type.String({ description: "Commit SHA" })),
          artifact: Type.Optional(Type.String()),
        }),
      ),
    }),
    async execute(_id: string, input: any, _s: unknown, _u: unknown, ctx: any) {
      const { runId, member, blocker, owner, resumeWhen, refs } = input;
      return text(
        await host(ctx).client().request("hold", { runId, handle: member, blocker, owner, resumeWhen, refs }),
      );
    },
  });

  pi.registerTool({
    name: "crew_handoff",
    label: "Crew: hand off a member",
    description:
      "End a member that is waiting for you (needs_input, failed or on_hold) as partial or superseded work, without accepting it: list the acceptance criteria it did not meet; its pull request, pushed head, last CI snapshot and salvage are kept as evidence and its VM is released. Its dependents are not released and nothing is approved or merged. A later crew_message recovers it in a new session.",
    parameters: Type.Object({
      runId: Type.String(),
      member: Type.String(),
      unmet: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      supersededBy: Type.Optional(Type.String({ description: "The work that replaces it, e.g. a pull request" })),
      note: Type.Optional(Type.String()),
    }),
    async execute(_id: string, input: any, _s: unknown, _u: unknown, ctx: any) {
      const { runId, member, unmet, supersededBy, note } = input;
      return text(await host(ctx).client().request("handoff", { runId, handle: member, unmet, supersededBy, note }));
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
