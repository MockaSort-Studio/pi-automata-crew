// Pure durable Crew lifecycle state contract. No I/O, no runtime wiring:
// callers own persistence and wiring. This module only defines the legal
// vocabulary and transition graph, and a small in-memory helper that
// enforces it.

export const STATES = Object.freeze(["queued", "running", "attention"]);

// Every Crew lifecycle terminalizes into exactly one outcome. "BLOCKED" is
// distinct from the transient "attention" state: it is the durable, final
// record that a run stalled unattended rather than being resolved.
export const TERMINAL_OUTCOMES = Object.freeze(["PASS", "BLOCKED", "FAIL"]);

const ALL_NODES = new Set([...STATES, ...TERMINAL_OUTCOMES]);

// Legal edges. Terminal outcomes intentionally have no outgoing edges.
const TRANSITIONS = Object.freeze({
  queued: Object.freeze(["running", "FAIL"]),
  running: Object.freeze(["attention", "PASS", "FAIL"]),
  attention: Object.freeze(["running", "BLOCKED", "FAIL"]),
  PASS: Object.freeze([]),
  BLOCKED: Object.freeze([]),
  FAIL: Object.freeze([]),
});

export function isTerminal(node) {
  return TERMINAL_OUTCOMES.includes(node);
}

export function canTransition(from, to) {
  const edges = TRANSITIONS[from];
  return Boolean(edges) && edges.includes(to);
}

export function transition(from, to) {
  if (canTransition(from, to)) return to;
  throw new Error(`Illegal Crew lifecycle transition: ${from} -> ${to}`);
}

// createLifecycle wraps the contract in a small, purely in-memory tracker:
// current state, full transition history, and a terminal check. It performs
// no side effects; durable persistence is the caller's responsibility.
export function createLifecycle(initial = "queued") {
  if (!ALL_NODES.has(initial)) {
    throw new Error(`Unknown Crew lifecycle state: ${initial}`);
  }
  const history = [initial];
  const lifecycle = {
    get state() {
      return history[history.length - 1];
    },
    get history() {
      return [...history];
    },
    isTerminal() {
      return isTerminal(lifecycle.state);
    },
    transition(to) {
      transition(lifecycle.state, to);
      history.push(to);
      return to;
    },
  };
  return lifecycle;
}
