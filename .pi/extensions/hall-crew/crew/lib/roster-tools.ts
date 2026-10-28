import { CONFIG_DIR_NAME, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { Type } from "typebox";
import {
  beginClose,
  discussionState,
  finishClose,
  readRoster,
  reconcileAbsentMembers,
  registerMembers,
  unregisterMembers,
  writeRoster,
} from "./comm.mjs";
import { assertOwnedRunId, crewRoot } from "./runtime-root.mjs";
const pathFor = (cwd, runId) =>
  join(cwd, CONFIG_DIR_NAME, "runtime", "crew-launch", `${assertOwnedRunId(runId)}-roster.json`);
const result = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: value });
const member = Type.Object({ name: Type.String(), actorId: Type.String(), role: Type.String() });
const removal = Type.Object({ actorId: Type.String(), removed: Type.Literal(true) });
function mutate(input, ctx, change) {
  const path = pathFor(crewRoot(ctx.cwd), input.runId);
  return withFileMutationQueue(path, async () => {
    const roster = change(readRoster(path));
    writeRoster(path, roster);
    return result(roster);
  });
}
export function registerRosterTools(pi) {
  pi.registerTool({
    name: "crew_register",
    label: "Crew: register members",
    description: "Atomically register specialist actors; Lead only.",
    parameters: Type.Object({
      runId: Type.String(),
      from: Type.String(),
      members: Type.Array(member, { minItems: 1 }),
    }),
    async execute(_id, input, _signal, _update, ctx) {
      return mutate(input, ctx, (roster) => registerMembers(roster, input.from, input.members));
    },
  });
  pi.registerTool({
    name: "crew_unregister",
    label: "Crew: unregister verified removals",
    description: "Lead-only removal after verified agents.remove results.",
    parameters: Type.Object({
      runId: Type.String(),
      from: Type.String(),
      removals: Type.Array(removal, { minItems: 1 }),
    }),
    async execute(_id, input, _signal, _update, ctx) {
      return mutate(input, ctx, (roster) => unregisterMembers(roster, input.from, input.removals));
    },
  });
  pi.registerTool({
    name: "crew_reconcile_absent",
    label: "Crew: reconcile absent actors",
    description: "Lead-only audited removal for rostered actors confirmed absent from Runtime.",
    parameters: Type.Object({
      runId: Type.String(),
      from: Type.String(),
      actorIds: Type.Array(Type.String(), { minItems: 1 }),
      observedAt: Type.String(),
    }),
    async execute(_id, input, _signal, _update, ctx) {
      return mutate(input, ctx, (roster) =>
        reconcileAbsentMembers(roster, input.from, input.actorIds, input.observedAt),
      );
    },
  });
  pi.registerTool({
    name: "crew_begin_close",
    label: "Crew: begin verified close",
    description: "Lead-only human-gated closure after GitHub confirmation.",
    parameters: Type.Object({ runId: Type.String(), from: Type.String(), closedAt: Type.String() }),
    async execute(_id, input, _signal, _update, ctx) {
      return mutate(input, ctx, (roster) => beginClose(roster, input.from, input.closedAt, discussionState(roster)));
    },
  });
  pi.registerTool({
    name: "crew_finish_close",
    label: "Crew: finish close",
    description: "Lead-only terminal transition after complete specialist cleanup.",
    parameters: Type.Object({ runId: Type.String(), from: Type.String() }),
    async execute(_id, input, _signal, _update, ctx) {
      return mutate(input, ctx, (roster) => finishClose(roster, input.from));
    },
  });
}
