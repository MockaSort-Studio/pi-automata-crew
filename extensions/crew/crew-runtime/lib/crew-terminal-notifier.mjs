// Read-only typed-state completion notifier. It never infers lifecycle from
// prose, worker settlement, or process state; callers provide Comm snapshots.
// A Crew whose nodes are all settled needs Main: to finish it, or to answer a blocked member,
// which resumes on that reply. Settling again after a resume notifies again.
const TERMINAL = new Set(["complete", "blocked", "failed"]);

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
  return {
    customType: "crew-terminal",
    content: counts.blocked
      ? `Crew ${namespace} is waiting for input (${summary}). A blocked member resumes when it receives a reply or message.`
      : `Crew ${namespace} reached terminal lifecycle state (${summary}).`,
    display: true,
    details: { namespace, counts },
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
    Promise.resolve(
      sendMessage(terminalMessage(namespace, nodesOf(snapshot)), { triggerTurn: true, deliverAs: "steer" }),
    ).catch(() => {});
    return true;
  }

  return { observe };
}
