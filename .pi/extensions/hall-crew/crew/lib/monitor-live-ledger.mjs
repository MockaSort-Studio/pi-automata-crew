// Keeps one read-only, typed dependency-status projection current for the
// active Crew run's plan, for the TUI's Plan tab / footer. Connects
// directly to that run's own CommController over WebSocket (roster.comm.url)
// as a dedicated, non-"main" observer actor and asks it for a typed state
// snapshot plus compact status updates (comm-state-owner.mjs, wired via
// comm-controller.mjs's "comm.state_snapshot"/"comm.observe_state"). The
// TUI never computes DAG transitions itself and never touches a raw
// envelope -- the Comm server is the live state owner; this module only
// projects what it reports.
//
// Why not Runtime.observeRawComm()? A real Crew is launched by the Crew MCP
// tool's own Runtime/process, not by whichever process is watching the Plan
// tab (e.g. a separate `cc` TUI session). Runtime.observeRawComm() is a
// permanent no-op (`if (!this.#comm) return () => {}`) unless *this*
// Runtime instance itself started that Crew's Comm controller, which in a
// real TUI session it never has.
import { connectComm } from "../../crew-runtime/lib/comm-client.mjs";

// The plan's static shape (handle/dependsOn/task) is read once from the
// local selected_crew_<uuid>.json -- not live state, just node identity --
// so the Plan tab has something to render before a connection lands. Every
// node starts "waiting" until the server's own snapshot/updates say
// otherwise; this module never derives a status on its own.
function structuralNodes(selected) {
  return (selected?.members ?? []).map((member) => ({
    handle: member.handle,
    status: "waiting",
    dependsOn: member.dependsOn || [],
    task: member.task || "",
  }));
}

function mergeStatus(nodes, updates) {
  const statusByHandle = new Map(updates.map((update) => [update.handle, update.status]));
  return nodes.map((node) =>
    statusByHandle.has(node.handle) ? { ...node, status: statusByHandle.get(node.handle) } : node,
  );
}

// A read-only facade over one run's live node list, matching the subset of
// dependency-ledger.mjs's interface readableDependencyLedgerSnapshot() and
// ledgerStatusByActor() already consume (has/status/nodes/dependenciesOf) --
// so neither of those callers needed to change for this projection to stop
// owning any DAG logic itself.
function ledgerFacadeFromRun(run) {
  return {
    has: (handle) => run.nodes.some((node) => node.handle === handle),
    status: (handle) => run.nodes.find((node) => node.handle === handle)?.status,
    nodes: () => run.nodes.map((node) => node.handle),
    dependenciesOf: (handle) => run.nodes.find((node) => node.handle === handle)?.dependsOn ?? [],
  };
}

export function createLiveLedgerTracker() {
  let key;
  let run; // { nodes, connectedUrl, client, unsubscribe } -- a fresh object per run key.

  function teardown() {
    run?.unsubscribe?.();
    run?.client?.close();
    run = undefined;
    key = undefined;
  }

  function connect(runId, commUrl, namespace, authToken, target) {
    target.connectedUrl = commUrl;
    const isCurrent = () => run === target && target.connectedUrl === commUrl;
    connectComm({ url: commUrl, actorId: `observer-${namespace}`, namespace, authToken })
      .then(async (connected) => {
        if (!isCurrent()) {
          // This run was torn down (or replaced) while the socket was
          // still connecting -- discard it, never attach.
          connected.close();
          return;
        }
        target.client = connected;
        const snapshot = await connected.getStateSnapshot(namespace).catch(() => undefined);
        if (!isCurrent()) {
          connected.close();
          return;
        }
        if (snapshot?.nodes) target.nodes = mergeStatus(target.nodes, snapshot.nodes);
        target.unsubscribe = connected.observeState(namespace, (update) => {
          if (isCurrent()) target.nodes = mergeStatus(target.nodes, update);
        });
      })
      .catch(() => {
        if (isCurrent()) target.connectedUrl = undefined;
      });
  }

  return {
    // `selected` is the parsed selected_crew_<uuid>.json plan document (or
    // null/undefined when the active roster has no plan recorded yet).
    // `commUrl` is that same run's roster.comm.url -- absent until the run
    // has actually started. Keyed by runId: a new Crew run always rebuilds
    // (a fresh `run` object, so any facade already handed out for a prior
    // run stays frozen at its last known state), an unchanged run always
    // reuses the same live connection.
    ledgerFor(selected, commUrl, authToken) {
      const nextKey = selected?.runId;
      if (!nextKey) {
        teardown();
        return undefined;
      }
      if (nextKey !== key) {
        teardown();
        run = { nodes: structuralNodes(selected), connectedUrl: undefined, client: undefined, unsubscribe: undefined };
        key = nextKey;
      }
      if (commUrl && run.connectedUrl !== commUrl) connect(key, commUrl, `crew-${key}`, authToken, run);
      return ledgerFacadeFromRun(run);
    },
    stop: teardown,
  };
}
