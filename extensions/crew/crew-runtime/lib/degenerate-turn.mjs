// Pure, side-effect-free so it is directly testable without any worker
// config/env setup. A turn that produced neither tokens nor a tool call is
// degenerate: the underlying provider/session call failed silently rather
// than the agent choosing to do nothing (a real no-op response still costs
// output tokens). Only meaningful once a turn_end was actually observed --
// callers must not treat "no turn_end fired at all" (e.g. a reply-driven
// completion) as degenerate.
export const isDegenerateTurn = (usage, toolCalls) =>
  !toolCalls && !usage?.input && !usage?.output && !usage?.cacheRead && !usage?.cacheWrite;

// Never persist a provider's raw error: it may contain credentials or request bodies.
export function providerFailureCategory(message) {
  if (message?.stopReason !== "error") return undefined;
  const text = String(message.errorMessage ?? "");
  if (/\b(?:401|403)\b|unauthorized|authentication/i.test(text)) return "authentication_or_permission";
  if (/\b429\b|rate.limit|quota/i.test(text)) return "rate_limit_or_quota";
  if (/\b(?:500|502|503|504)\b|overloaded/i.test(text)) return "provider_unavailable";
  if (/\b404\b|model.*not.found/i.test(text)) return "model_not_found";
  return "provider_error";
}
