// Pure dependency DAG ledger for Crew work items. No I/O, no Comm wiring:
// callers own persistence and orchestration. This module only tracks
// validated node handles, their prerequisite edges, and the legal status
// transitions each node moves through as its dependencies resolve.

import { canonicalHandle } from "./discussion-templates.mjs";

export const NODE_STATES = Object.freeze(["waiting", "ready", "running", "complete", "blocked", "failed"]);

// `blocked` is not terminal: a member that blocks itself awaits input and resumes when it
// receives it. complete and failed end a node, except that Main may reopen a complete node with
// a follow-up (see reopen): a node's last word must stay true when the work is not over.
const TERMINAL_STATES = new Set(["complete", "failed"]);
// Every state a node can settle in without further work: a Crew whose nodes are all settled
// needs Main, either to finish or to answer a blocked member.
const SETTLED_STATES = new Set(["complete", "blocked", "failed"]);

const TRANSITIONS = Object.freeze({
  waiting: Object.freeze(["ready", "running", "blocked"]),
  ready: Object.freeze(["running", "blocked", "waiting"]),
  running: Object.freeze(["waiting", "complete", "failed", "blocked"]),
  complete: Object.freeze(["running"]),
  blocked: Object.freeze(["running", "waiting"]),
  failed: Object.freeze([]),
});

export function isTerminalStatus(status) {
  return TERMINAL_STATES.has(status);
}

export function isSettledStatus(status) {
  return SETTLED_STATES.has(status);
}

export function canTransition(from, to) {
  const edges = TRANSITIONS[from];
  return Boolean(edges) && edges.includes(to);
}

// hasPath answers: starting from a node's recorded prerequisites, can we
// reach `target`? Used to reject an edge that would close a cycle.
function hasPath(dependsOn, from, target) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const current = stack.pop();
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const prerequisite of dependsOn.get(current) || []) stack.push(prerequisite);
  }
  return false;
}

// createDependencyLedger tracks a DAG of validated handles and the status
// each one carries through waiting -> ready -> running -> complete, with
// failed as the terminal off-ramp and blocked as a resumable one. Ledger recomputes
// readiness for direct dependents on completion and propagates blocked on
// failure/block. A node that blocked itself resumes to running; a node blocked only
// because of a prerequisite returns to waiting once no prerequisite holds it.
export function createDependencyLedger() {
  const status = new Map();
  const dependsOn = new Map();
  const dependents = new Map();
  // Nodes that reported blocked themselves, as opposed to being blocked by a prerequisite.
  const selfBlocked = new Set();

  function requireNode(handle) {
    if (!status.has(handle)) throw new Error(`Unknown dependency ledger node: ${handle}`);
    return handle;
  }

  function addNode(rawHandle) {
    const handle = canonicalHandle(rawHandle);
    if (status.has(handle)) throw new Error(`Dependency ledger node already exists: ${handle}`);
    status.set(handle, "waiting");
    dependsOn.set(handle, new Set());
    dependents.set(handle, new Set());
    return handle;
  }

  function addDependency(rawHandle, rawDependsOn) {
    const handle = requireNode(canonicalHandle(rawHandle));
    const prerequisite = requireNode(canonicalHandle(rawDependsOn));
    if (handle === prerequisite) throw new Error(`Dependency ledger node cannot depend on itself: ${handle}`);
    if (hasPath(dependsOn, prerequisite, handle)) {
      throw new Error(`Dependency ledger edge would create a cycle: ${prerequisite} -> ${handle}`);
    }
    dependsOn.get(handle).add(prerequisite);
    dependents.get(prerequisite).add(handle);
    refreshOne(handle);
    return { handle, dependsOn: prerequisite };
  }

  function moveTo(handle, to) {
    const from = requireNode(handle) && status.get(handle);
    if (!canTransition(from, to))
      throw new Error(`Illegal dependency ledger transition for ${handle}: ${from} -> ${to}`);
    status.set(handle, to);
    return to;
  }

  // refreshOne promotes waiting -> ready once every prerequisite is
  // complete (vacuously true for a node with none); it never demotes a
  // node already ready/running/terminal.
  function refreshOne(handle) {
    if (status.get(handle) !== "waiting") return;
    const prerequisites = [...dependsOn.get(handle)];
    if (prerequisites.every((node) => status.get(node) === "complete")) {
      moveTo(handle, "ready");
    }
  }

  function propagateBlocked(handle) {
    const stack = [...dependents.get(handle)];
    while (stack.length) {
      const dependent = stack.pop();
      if (!isSettledStatus(status.get(dependent))) {
        moveTo(dependent, "blocked");
        stack.push(...dependents.get(dependent));
      }
    }
  }

  const holds = (handle) => ["blocked", "failed"].includes(status.get(handle));

  // After a prerequisite resumes, a dependent blocked only by propagation returns to waiting
  // when none of its prerequisites still holds it, and that recovery continues downstream.
  function restoreDependents(handle) {
    const stack = [...dependents.get(handle)];
    while (stack.length) {
      const dependent = stack.pop();
      if (status.get(dependent) !== "blocked" || selfBlocked.has(dependent)) continue;
      if ([...dependsOn.get(dependent)].some(holds)) continue;
      moveTo(dependent, "waiting");
      refreshOne(dependent);
      stack.push(...dependents.get(dependent));
    }
  }

  function start(rawHandle) {
    const handle = requireNode(canonicalHandle(rawHandle));
    if (status.get(handle) === "blocked") return resume(handle, "running");
    // A complete node is only ever brought back by reopen(), which also settles its dependents.
    if (status.get(handle) === "complete")
      throw new Error(`Illegal dependency ledger transition for ${handle}: complete -> running (use reopen)`);
    refreshOne(handle);
    return moveTo(handle, "running");
  }

  // Leaves a self-reported block; a node blocked only by a prerequisite cannot leave it itself.
  function resume(handle, to) {
    if (!selfBlocked.has(handle))
      throw new Error(`${handle} is blocked by a prerequisite and cannot resume before it does`);
    selfBlocked.delete(handle);
    moveTo(handle, to);
    restoreDependents(handle);
    return to;
  }

  function wait(rawHandle) {
    const handle = requireNode(canonicalHandle(rawHandle));
    if (status.get(handle) === "blocked") return resume(handle, "waiting");
    return moveTo(handle, "waiting");
  }

  function complete(rawHandle) {
    const handle = canonicalHandle(rawHandle);
    const to = moveTo(handle, "complete");
    for (const dependent of dependents.get(handle)) refreshOne(dependent);
    return to;
  }

  // A complete node that works again (Main sent it a follow-up) is running again, so whatever depends on it
  // can no longer rely on its result: dependents that have not started return to waiting. Dependents that
  // are already running or complete ran with the earlier result and are left alone. Without this, a
  // member that fails or asks a question after being completed would still read as complete.
  function reopen(rawHandle) {
    const handle = requireNode(canonicalHandle(rawHandle));
    if (status.get(handle) !== "complete")
      throw new Error(`Illegal dependency ledger transition for ${handle}: only a complete node can be reopened`);
    const to = moveTo(handle, "running");
    for (const dependent of dependents.get(handle)) if (status.get(dependent) === "ready") moveTo(dependent, "waiting");
    return to;
  }

  function fail(rawHandle) {
    const handle = canonicalHandle(rawHandle);
    const to = moveTo(handle, "failed");
    propagateBlocked(handle);
    return to;
  }

  function block(rawHandle) {
    const handle = canonicalHandle(rawHandle);
    const to = moveTo(handle, "blocked");
    selfBlocked.add(handle);
    propagateBlocked(handle);
    return to;
  }

  // has answers existence without throwing, for wiring code that receives
  // handles from untrusted sources (raw Comm envelopes) and must ignore
  // anything that is not a node this ledger tracks.
  function has(rawHandle) {
    try {
      return status.has(canonicalHandle(rawHandle));
    } catch {
      return false;
    }
  }

  return {
    addNode,
    addDependency,
    has,
    start,
    wait,
    complete,
    reopen,
    fail,
    block,
    status: (rawHandle) => status.get(requireNode(canonicalHandle(rawHandle))),
    dependenciesOf: (rawHandle) => [...dependsOn.get(requireNode(canonicalHandle(rawHandle)))],
    dependentsOf: (rawHandle) => [...dependents.get(requireNode(canonicalHandle(rawHandle)))],
    nodes: () => [...status.keys()],
    snapshot: () => Object.fromEntries(status),
  };
}
