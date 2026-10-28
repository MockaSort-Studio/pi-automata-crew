// Pure mapping from a `pi --mode rpc` event to one bounded, mostly
// content-free log record (or null to skip). Kept separate from worker.mjs
// so the mapping is unit-testable without spawning a real Pi process.

const MAX_ERROR_CHARS = 4000;

// Fire-and-forget extension_ui_request "notify" carrying this prefix is how
// the in-process worker extension smuggles content-free static-context token
// counts (system-prompt + tool-schema sizes) across the RPC boundary: RPC
// events carry no system-prompt or tool-schema data of their own.
export const STATIC_CONTEXT_MARKER = "__crew_static_context__:";

// Same relay mechanism, carrying the worker's own actually-resolved model
// id (read from the live RPC session at agent_start, never guessed) instead
// of the launch-config model, which is frequently absent -- a worker
// inherits whatever default `pi --mode rpc` resolves to when no `--model`
// flag was passed, and nothing else observes that resolution.
export const RESOLVED_MODEL_MARKER = "__crew_resolved_model__:";

export const boundedText = (value, max) => {
  const text = String(value);
  return text.length <= max
    ? text
    : `${text.slice(0, max / 2)}\n…[truncated ${text.length - max} bytes]…\n${text.slice(-max / 2)}`;
};

// Size in bytes without retaining the content itself: safe for tool results
// that may contain file bodies, secrets, or otherwise unbounded text.
const byteSize = (value) => {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "");
  } catch {
    return null;
  }
};

export function mapWorkerEvent(event) {
  switch (event.type) {
    case "agent_start":
      return { type: "agent_start" };
    case "turn_end": {
      const output = (event.message?.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      return {
        type: "turn",
        usage: event.message?.usage,
        outputChars: output.length,
        toolCalls: (event.message?.content ?? []).filter((part) => part.type === "toolCall").length,
      };
    }
    case "tool_execution_start":
      return { type: "tool_start", id: event.toolCallId, name: event.toolName };
    case "tool_execution_end":
      return {
        type: "tool_end",
        id: event.toolCallId,
        name: event.toolName,
        error: event.isError,
        resultBytes: byteSize(event.result),
      };
    case "compaction_start":
      return { type: "compaction_start", reason: event.reason };
    case "compaction_end":
      return { type: "compaction_end", reason: event.reason };
    case "extension_error":
      return { type: "agent_error", message: boundedText(event.error, MAX_ERROR_CHARS) };
    case "extension_ui_request": {
      if (event.method !== "notify" || typeof event.message !== "string") return null;
      if (event.message.startsWith(RESOLVED_MODEL_MARKER)) {
        try {
          const { modelId, modelWindow } = JSON.parse(event.message.slice(RESOLVED_MODEL_MARKER.length));
          return typeof modelId === "string" && modelId.length > 0
            ? { type: "resolved_model", modelId, ...(Number.isFinite(modelWindow) ? { modelWindow } : {}) }
            : null;
        } catch {
          return null;
        }
      }
      if (!event.message.startsWith(STATIC_CONTEXT_MARKER)) return null;
      try {
        const tokens = JSON.parse(event.message.slice(STATIC_CONTEXT_MARKER.length));
        return { type: "static_context", tokens };
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}
