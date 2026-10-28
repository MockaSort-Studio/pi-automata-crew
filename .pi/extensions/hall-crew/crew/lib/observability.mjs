import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assistantTextTokens,
  staticContextTokens,
  toolCallTokens,
  toolKind,
  toolResultTokens,
  toolWindowTotals,
} from "./observability-ledger.mjs";
import { crewRoot } from "./runtime-root.mjs";

const SUMMARY_TOOLS = new Set(["read", "bash"]);
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? null));
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

function crewActor(cwd, configDir, actorId) {
  if (!actorId) return null;
  const root = join(cwd, configDir, "runtime", "crew-launch");
  if (!existsSync(root)) return null;
  for (const file of readdirSync(root).filter((name) => name.endsWith("-roster.json"))) {
    const roster = readJson(join(root, file));
    const actor =
      roster?.lead?.actorId === actorId ? roster.lead : roster?.members?.find((value) => value.actorId === actorId);
    if (actor) return { roster, actor, file };
  }
  return null;
}

export function crewIdentity(cwd, configDir, actorId = process.env.PI_SDK_ACTOR_ID) {
  const found = crewActor(cwd, configDir, actorId);
  return found && { runId: found.roster.runId, actorId, rolePersona: found.actor.name, rosterFile: found.file };
}

export function crewResultSummaryLimit(cwd, configDir, actorId = process.env.PI_SDK_ACTOR_ID) {
  const limit = crewActor(cwd, configDir, actorId)?.roster?.resultSummaryMaxBytes;
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

export function contextDelta(previous, current) {
  return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
}

export function contextSource(toolNames) {
  return toolNames.length ? "native" : "none";
}

export function resultBytes(result) {
  return bytes({ content: result?.content, details: result?.details });
}

export function summarizeCrewToolResult(event, limit) {
  const originalBytes = resultBytes(event);
  if (event.isError || !SUMMARY_TOOLS.has(event.toolName) || originalBytes <= limit) return null;
  return {
    content: [
      {
        type: "text",
        text: `Crew experiment summary: ${event.toolName} returned ${originalBytes} bytes, exceeding the ${limit}-byte bound. Content was omitted; repeat a narrower, bounded query if evidence is needed.`,
      },
    ],
    details: { crewResultSummary: true, tool: event.toolName, originalBytes, limit },
  };
}

function usageSummary(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => typeof value === "number"));
}

export function registerCrewObservability(pi, configDir) {
  const contextByActor = new Map();
  const toolWindowByActor = new Map();
  const pendingToolCalls = new Map();
  const identity = (ctx) => crewIdentity(crewRoot(ctx.cwd), configDir);
  const actorKey = (actor) => `${actor.runId}:${actor.actorId}`;
  const callKey = (actor, callId) => `${actorKey(actor)}:${callId}`;
  const write = (ctx, event) => {
    const actor = identity(ctx);
    if (!actor) return;
    const dir = join(crewRoot(ctx.cwd), configDir, "runtime", "crew-observability");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, `${actor.runId}.jsonl`),
      `${JSON.stringify({ at: new Date().toISOString(), ...actor, ...event })}\n`,
    );
  };
  const staticContext = (ctx) => {
    const active = new Set(pi.getActiveTools());
    const tools = pi
      .getAllTools()
      .filter((tool) => active.has(tool.name))
      .map(({ name, parameters }) => ({ name, parameters }));
    return staticContextTokens(ctx.getSystemPrompt(), tools);
  };

  pi.on("agent_start", (_event, ctx) => write(ctx, { type: "activation_start", staticContext: staticContext(ctx) }));
  pi.on("agent_end", (_event, ctx) => write(ctx, { type: "activation_end" }));
  pi.on("tool_result", (event, ctx) => {
    const limit = crewResultSummaryLimit(crewRoot(ctx.cwd), configDir);
    return limit && summarizeCrewToolResult(event, limit);
  });
  pi.on("tool_call", (event, ctx) => {
    const actor = identity(ctx);
    if (!actor) return;
    pendingToolCalls.set(callKey(actor, event.toolCallId), {
      kind: toolKind(event.toolName),
      callTokens: toolCallTokens(event.toolName, event.input),
    });
  });
  pi.on("tool_execution_end", (event, ctx) => {
    const actor = identity(ctx);
    if (!actor) return;
    const key = actorKey(actor);
    const pendingKey = callKey(actor, event.toolCallId);
    const call = pendingToolCalls.get(pendingKey) || { kind: toolKind(event.toolName), callTokens: 0 };
    pendingToolCalls.delete(pendingKey);
    const entry = { tool: event.toolName, ...call, resultTokens: toolResultTokens(event.result) };
    const toolWindow = toolWindowByActor.get(key) || [];
    toolWindow.push(entry);
    toolWindowByActor.set(key, toolWindow);
    write(ctx, {
      type: "tool",
      ...entry,
      resultBytes: resultBytes(event.result),
      error: Boolean(event.isError),
    });
  });
  pi.on("turn_end", (event, ctx) => {
    const actor = identity(ctx);
    if (!actor) return;
    const key = actorKey(actor);
    const current = ctx.getContextUsage()?.tokens;
    const previous = contextByActor.get(key);
    const toolWindow = toolWindowByActor.get(key) || [];
    if (Number.isFinite(current)) contextByActor.set(key, current);
    toolWindowByActor.set(key, []);
    write(ctx, {
      type: "response",
      contextTokens: current,
      contextDelta: contextDelta(previous, current),
      contextSource: contextSource(toolWindow.map((entry) => entry.tool)),
      toolWindow: toolWindowTotals(toolWindow),
      assistantTextTokens: assistantTextTokens(event.message),
      usage: usageSummary(event.message?.usage),
    });
  });
  pi.on("session_compact", (_event, ctx) => write(ctx, { type: "compaction" }));
}
