import { Type } from "typebox";
import { formatDoctor, runDoctor } from "../../env-runtime/lib/doctor.mjs";

// Can this machine run a Crew? One answer, with what to fix. Available to the user as /crew-doctor and to the
// model as a tool, so a failed launch can be diagnosed without guessing.
export function registerCrewDoctor(pi: any) {
  pi.registerCommand("crew-doctor", {
    description: "Check that this machine can run a Crew (boots a VM)",
    handler: async (_args: string, ctx: any) => {
      ctx.ui.notify("Checking Crew requirements (this boots a VM)...", "info");
      const report = await runDoctor();
      ctx.ui.notify(formatDoctor(report), report.ok ? "info" : "error");
    },
  });
  pi.registerTool({
    name: "crew_doctor",
    label: "Crew: doctor",
    description:
      "Check that this machine can run a Crew: Node, git, the VM monitor, the guest image, a real VM boot, the Armory source and the GitHub credential. Says what to fix.",
    parameters: Type.Object({
      boot: Type.Optional(Type.Boolean({ description: "Boot a VM to prove it works (default true)" })),
    }),
    async execute(_id: string, input: { boot?: boolean }) {
      const report = await runDoctor({ boot: input.boot ?? true });
      return { content: [{ type: "text" as const, text: formatDoctor(report) }], details: report };
    },
  });
}
