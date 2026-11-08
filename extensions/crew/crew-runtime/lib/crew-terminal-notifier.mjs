// Read-only typed-state completion notifier. It never infers lifecycle from
// prose, worker settlement, or process state; callers provide Comm snapshots.
// A Crew whose nodes are all settled needs Main: to finish it, or to answer a blocked member,
// which resumes on that reply. Settling again after a resume notifies again.
const TERMINAL = new Set(["complete", "blocked", "failed"]);
// A node may also carry the crew host's member `state`. A blocked node in one of these states needs no answer
// from Main: Main put it on hold, handed it off or cancelled it, or it is only held behind a prerequisite.
const DECIDED = new Set(["on_hold", "handed_off", "held", "cancelled"]);
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
  const runs = new Map();

  function observe(snapshot) {
    const namespace = snapshot?.namespace;
    if (!namespace || !nodesOf(snapshot).length) return false;
    let run = runs.get(namespace);
    if (!run) {
      run = { seenSnapshot: true, notified: false };
      runs.set(namespace, run);
    }
    if (!terminal(snapshot)) {
      run.notified = false;
      return false;
    }
    if (run.notified) return false;
    run.notified = true;
    const { triggerTurn, ...message } = terminalMessage(namespace, nodesOf(snapshot));
    const options = triggerTurn ? { triggerTurn, deliverAs: "steer" } : { triggerTurn };
    Promise.resolve(sendMessage(message, options)).catch(() => {});
    return true;
  }

  return { observe };
}
