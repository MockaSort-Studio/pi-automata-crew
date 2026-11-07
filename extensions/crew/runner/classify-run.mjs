import { providerFailureCategory } from "./provider-failure.mjs";

// The runner, not the model, decides what happened. Everything here is derived from the session's own
// messages (stop reason, content, usage) and from facts the runner itself recorded (an abort it issued, a
// question the agent asked). The agent's own claim of being done is never an input.
const textOf = (message) =>
  (message?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

const emptyUsage = () => ({ turns: 0, toolCalls: 0, toolErrors: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function summarizeUsage(messages) {
  const usage = emptyUsage();
  for (const message of messages) {
    if (message.role === "assistant") {
      usage.turns += 1;
      usage.toolCalls += (message.content ?? []).filter((part) => part.type === "toolCall").length;
      for (const key of ["input", "output", "cacheRead", "cacheWrite"]) usage[key] += Number(message.usage?.[key]) || 0;
    } else if (message.role === "toolResult" && message.isError) usage.toolErrors += 1;
  }
  return usage;
}

// Only a status code from the provider's error is kept; its text may carry request ids or other secrets.
const httpStatus = (message) => /^(\d{3})\b/.exec(String(message?.errorMessage ?? ""))?.[1];

const failed = (category, extra = {}) => ({ status: "failed", failure: { category, ...extra } });

export function classifyRun({ messages = [], cancelled = false, inputRequest, thrown } = {}) {
  const last = [...messages].reverse().find((message) => message.role === "assistant");
  const base = { finalText: textOf(last), usage: summarizeUsage(messages) };
  if (inputRequest) return { ...base, status: "needs_input", question: inputRequest.question };
  if (cancelled) return { ...base, status: "cancelled" };
  if (thrown) return { ...base, ...failed("runtime_error") };
  if (!last) return { ...base, ...failed("empty_turn") };
  if (last.stopReason === "error") {
    const status = httpStatus(last);
    return { ...base, ...failed(providerFailureCategory(last), status ? { httpStatus: Number(status) } : {}) };
  }
  if (last.stopReason === "aborted") return { ...base, ...failed("aborted") };
  if (last.stopReason === "length") return { ...base, ...failed("output_limit") };
  if (last.stopReason !== "stop") return { ...base, ...failed("incomplete", { stopReason: last.stopReason }) };
  if (!base.finalText) return { ...base, ...failed("empty_turn") };
  return { ...base, status: "completed" };
}
