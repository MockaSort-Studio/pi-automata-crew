// Read-only typed-state completion notifier. It never infers lifecycle from
// prose, worker settlement, or process state; callers provide Comm snapshots.
// A Crew whose nodes are all settled needs Main: to finish it, or to answer a blocked member,
// which resumes on that reply.
//
// One contract: a run is notified once per settling, and settles again only after it worked again. Work
// resuming is either a snapshot with a node that is not settled (the Comm path observes every change), or
// `resume(namespace)`, which the crew host calls when a member reports `running` (it observes only idle
// snapshots, which are always settled). `forget(namespace)` drops a run that was disposed; with no namespace,
// every run.
const TERMINAL = new Set(["complete", "blocked", "failed"]);
// A node may also carry the crew host's member `state`. A blocked node in one of these states needs no answer
// from Main: Main put it on hold or handed it off, or it is only held behind a prerequisite. (A cancelled
// member's node is failed, never blocked.)
const DECIDED = new Set(["on_hold", "handed_off", "held"]);
const awaitingMain = (node) => node.status === "blocked" && !DECIDED.has(node.state);

function nodesOf(snapshot) {
  return Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
}

function terminal(snapshot) {
  const nodes = nodesOf(snapshot);
  return nodes.length > 0 && nodes.every((node) => TERMINAL.has(node?.status));
}

function terminalMessage(namespace, nodes) {
  const counts = Object.fromEntries(
    [...TERMINAL].map((status) => [status, nodes.filter((node) => node.status === status).length]),
  );
  const summary = Object.entries(counts)
    .filter(([, count]) => count)
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  const waiting = nodes.some(awaitingMain);
  return {
    customType: "crew-terminal",
    content: waiting
      ? `Crew ${namespace} is waiting for input (${summary}). A blocked member resumes when it receives a reply or message.`
      : counts.blocked
        ? `Crew ${namespace} is settled (${summary}). No member waits for an answer: each blocked one is on hold, handed off, cancelled or held behind one of those, and resumes only when Main messages it.`
        : `Crew ${namespace} reached terminal lifecycle state (${summary}).`,
    display: true,
    details: { namespace, counts },
    // Only a crew that needs Main's answer, or that has finished, starts a Main turn.
    triggerTurn: waiting || !counts.blocked,
  };
}

export function createCrewTerminalNotifier(sendMessage) {
  if (typeof sendMessage !== "function") throw new TypeError("sendMessage must be a function");
  // Runs notified since they last worked.
  const notified = new Set();

  function observe(snapshot) {
    const namespace = snapshot?.namespace;
    if (!namespace || !nodesOf(snapshot).length) return false;
    if (!terminal(snapshot)) {
      notified.delete(namespace);
      return false;
    }
    if (notified.has(namespace)) return false;
    notified.add(namespace);
    const { triggerTurn, ...message } = terminalMessage(namespace, nodesOf(snapshot));
    const options = triggerTurn ? { triggerTurn, deliverAs: "steer" } : { triggerTurn };
    Promise.resolve(sendMessage(message, options)).catch(() => {});
    return true;
  }

  return {
    observe,
    resume: (namespace) => void notified.delete(namespace),
    forget: (namespace) => void (namespace === undefined ? notified.clear() : notified.delete(namespace)),
  };
}
