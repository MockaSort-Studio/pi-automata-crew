// Pure, side-effect-free so it is directly testable without any worker
// config/env setup. A turn that produced neither tokens nor a tool call is
// degenerate: the underlying provider/session call failed silently rather
// than the agent choosing to do nothing (a real no-op response still costs
// output tokens). Only meaningful once a turn_end was actually observed --
// callers must not treat "no turn_end fired at all" (e.g. a reply-driven
// completion) as degenerate.
export const isDegenerateTurn = (usage, toolCalls) =>
  !toolCalls && !usage?.input && !usage?.output && !usage?.cacheRead && !usage?.cacheWrite;
