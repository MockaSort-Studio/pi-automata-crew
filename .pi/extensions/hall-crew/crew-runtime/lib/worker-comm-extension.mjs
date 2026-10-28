import { readFileSync } from "node:fs";
import { Type } from "typebox";
import { connectComm } from "./comm-client.mjs";
import { staticContextTokens } from "../../crew/lib/observability-ledger.mjs";
import { isDegenerateTurn } from "./degenerate-turn.mjs";
import { RESOLVED_MODEL_MARKER, STATIC_CONTEXT_MARKER } from "./worker-events.mjs";
const config = JSON.parse(readFileSync(process.env.PI_CREW_WORKER_CONFIG, "utf8"));
let comm;
// A resident worker's own startup sends `new_session` (see worker.mjs), which fires
// session_shutdown -> reload -> session_start again in this process, possibly before the first
// connectComm() resolved. Without a guard, two `comm.register` calls for one actorId would race
// and the server would reject one. commReady makes connect+subscribe idempotent per process.
let commReady;
// new_session also replaces `pi`/ctx on every reload, and a captured one goes stale. The
// onDelivery listener is registered once, so it calls through this pointer, updated on each
// workerCommExtension(pi) invocation, never through a captured `pi`.
let activePi;
// Shared across reloads for the same reason: turn_end writes it, the once-registered listener reads it.
let staticContextReported = false;
// sawTurnEnd separates "a turn_end fired and it was empty" (degenerate, retry) from "none fired
// before settling" (a legitimate reply-driven completion that must not trigger a retry).
let sawTurnEnd, lastTurnUsage, lastTurnToolCalls;
let replyContext;
let kickoffManifest;
let firstDelivery = true;
let deliveries = Promise.resolve();
const settledWaiters = [];
const nextSettled = () => new Promise((resolve) => settledWaiters.push(resolve));
// "main" is the one canonical, pre-registered actor id: it is never
// namespace-qualified, unlike every other Crew recipient handle.
const qualify = (id) =>
  id !== "main" && config.comm?.namespace && !id.startsWith(`${config.comm.namespace}-`)
    ? `${config.comm.namespace}-${id}`
    : id;
const result = async (operation) => ({ content: [{ type: "text", text: JSON.stringify(await operation) }] });
const deliveryPrompt = (message) => {
  const delivery = `Communication delivery: ${JSON.stringify({ from: message.from, payload: message.payload, replyRequired: Boolean(message.replyRequired) })}`;
  return firstDelivery && config.initialTurn === "first-delivery" ? `${config.task}\n\n${delivery}` : delivery;
};
const requireComm = () => comm ?? (() => { throw new Error("Crew communication is not ready"); })();
const granted = new Set(config.commTools ?? ["comm_notify", "comm_request", "comm_reply"]);
export default function workerCommExtension(pi) {
  activePi = pi;
  pi.on("turn_end", (event) => {
    sawTurnEnd = true;
    lastTurnUsage = event.message?.usage;
    lastTurnToolCalls = (event.message?.content ?? []).filter((part) => part.type === "toolCall").length;
  });
  pi.on("agent_start", (_event, ctx) => {
    if (staticContextReported) return;
    staticContextReported = true;
    const active = new Set(pi.getActiveTools());
    const tools = pi
      .getAllTools()
      .filter((tool) => active.has(tool.name))
      .map(({ name, parameters }) => ({ name, parameters }));
    const tokens = staticContextTokens(ctx.getSystemPrompt(), tools);
    ctx.ui.notify(`${STATIC_CONTEXT_MARKER}${JSON.stringify(tokens)}`, "info");
    // Relay the resolved model id: a worker started without --model inherits Pi's default,
    // which the launch config never captures; ctx.model is where it is knowable.
    const modelId = ctx.model?.provider && ctx.model?.id ? `${ctx.model.provider}/${ctx.model.id}` : ctx.model?.id;
    const modelWindow = Number.isFinite(ctx.model?.contextWindow) ? ctx.model.contextWindow : undefined;
    if (modelId) ctx.ui.notify(`${RESOLVED_MODEL_MARKER}${JSON.stringify({ modelId, modelWindow })}`, "info");
  });
  if (!config.comm) return;
  const ensureCommConnected = () => {
    commReady ??= (async () => {
      comm = await connectComm(config.comm);
      await comm.ready(config.comm.namespace);
      comm.onDelivery((message) => {
        // A kickoff is a shared manifest, not an assignment. Retain it as
        // trusted runtime context and acknowledge it without spending a model turn.
        if (message.payload?.kind === "kickoff" && message.payload?.phase === "manifest") {
          kickoffManifest = message.payload;
          comm.acknowledge(message.id);
          return;
        }
        deliveries = deliveries.then(async () => {
          replyContext = message;
          await comm.lifecycleUpdate(config.comm.namespace, "running");
          const prompt = deliveryPrompt(message);
          let settled = nextSettled();
          sawTurnEnd = false;
          await activePi.sendUserMessage(prompt, { deliverAs: "followUp" });
          await settled;
          if (sawTurnEnd && isDegenerateTurn(lastTurnUsage, lastTurnToolCalls)) {
            settled = nextSettled();
            sawTurnEnd = false;
            await activePi.sendUserMessage(prompt, { deliverAs: "followUp" });
            await settled;
            if (sawTurnEnd && isDegenerateTurn(lastTurnUsage, lastTurnToolCalls)) {
              try {
                await comm.emit({
                  to: "main",
                  payload: {
                    kind: "report",
                    status: "BLOCKED",
                    reason: "empty-turn",
                    detail: "Two consecutive empty provider turns (no tokens, no tool call) for this delivery.",
                  },
                });
              } catch {}
            }
          }
          await comm.acknowledge(message.id);
          replyContext = undefined;
          firstDelivery = false;
        });
      });
    })();
    return commReady;
  };
  pi.registerTool({
    name: "lifecycle_update",
    label: "Lifecycle: update current work state",
    description:
      "Set your typed work state. Use waiting only while pausing active work; terminal states are required at completion, block, or failure.",
    parameters: Type.Object({
      state: Type.Union([
        Type.Literal("running"),
        Type.Literal("waiting"),
        Type.Literal("complete"),
        Type.Literal("blocked"),
        Type.Literal("failed"),
      ]),
    }),
    execute: (_id, input) => result(requireComm().lifecycleUpdate(config.comm.namespace, input.state)),
  });
  if (granted.has("comm_notify"))
    pi.registerTool({
      name: "comm_notify",
      label: "Communication: notify",
      description: "Notify a Crew recipient without requiring a reply.",
      parameters: Type.Object({ to: Type.String(), payload: Type.Unknown() }),
      execute: (_id, input) => result(requireComm().emit({ ...input, to: qualify(input.to), replyRequired: false })),
    });
  if (granted.has("comm_request"))
    pi.registerTool({
      name: "comm_request",
      label: "Communication: request",
      description: "Send a Crew recipient a message that requires a reply.",
      parameters: Type.Object({ to: Type.String(), payload: Type.Unknown() }),
      execute: (_id, input) => result(requireComm().emit({ ...input, to: qualify(input.to), replyRequired: true })),
    });
  if (granted.has("comm_reply"))
    pi.registerTool({
      name: "comm_reply",
      label: "Communication: reply",
      description: "Reply to the current communication delivery.",
      parameters: Type.Object({ payload: Type.Unknown() }),
      execute: (_id, input) => {
        if (!replyContext?.replyRequired) throw new Error("Current delivery does not require a reply");
        return result(requireComm().emit({ to: replyContext.from, payload: input.payload, replyTo: replyContext.id }));
      },
    });
  if (granted.has("comm_notify_all"))
    pi.registerTool({
      name: "comm_notify_all",
      label: "Communication: notify all",
      description: "Notify every other Crew member (never Main). Lead-only coordination broadcast.",
      parameters: Type.Object({ payload: Type.Unknown() }),
      execute: (_id, input) =>
        result(
          requireComm().broadcast({ namespace: config.comm.namespace, payload: input.payload }),
        ),
    });
  if (granted.has("crew_assign"))
    pi.registerTool({
      name: "crew_assign",
      label: "Crew: assign",
      description:
        "Lead-only. Send a Crew member its planned task (from the plan Main briefed you with), optionally with a short note. The broker refuses a member whose prerequisites are not complete, one already assigned, or anyone not in the plan.",
      parameters: Type.Object({ to: Type.String(), note: Type.Optional(Type.String()) }),
      execute: (_id, input) =>
        result(requireComm().assign({ namespace: config.comm.namespace, to: String(input.to).replace(`${config.comm.namespace}-`, ""), note: input.note })),
    });
  pi.on("agent_settled", () => settledWaiters.splice(0).forEach((resolve) => resolve()));
  pi.on("session_start", () => ensureCommConnected());
  // Only a real process-ending shutdown ever closes the Comm socket. A
  // same-process reload ("new" or "reload", from the new_session call above)
  // must leave the live connection and its onDelivery subscription intact --
  // closing here would both orphan the one live registration this process is
  // allowed to hold, and would fail every delivery for the rest of this
  // worker's life.
  pi.on("session_shutdown", async (event) => {
    if (event.reason !== "quit") return;
    await deliveries;
    comm?.close();
  });
}
