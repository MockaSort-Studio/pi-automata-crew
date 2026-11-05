// Wires CommController's two out-of-process observer surfaces: the raw envelope stream
// ("comm.observe_raw") and the typed live-state API ("comm.register_plan" / "comm.state_snapshot"
// / "comm.observe_state"), so comm-controller.mjs stays focused on mailbox and delivery.
import { createCommStateOwner } from "../../crew/lib/comm-state-owner.mjs";

// At most one subscription per key, so a repeated call or a reconnecting actor never
// accumulates duplicate pushes.
class Subscriptions {
  #active = new Map();

  once(key, start) {
    if (!this.#active.has(key)) this.#active.set(key, start());
    return { observing: true };
  }

  release(matches) {
    for (const [key, unsubscribe] of this.#active)
      if (matches(key)) {
        unsubscribe();
        this.#active.delete(key);
      }
  }
}

// `observeRaw` is CommController#observeRaw bound to it; `getSocket(actorId)` finds a live connection.
export function createCommObservers({ observeRaw, getSocket }) {
  const subscriptions = new Subscriptions();
  // Lifecycle updates, not free-form Comm envelopes, own typed run state.
  const stateOwner = createCommStateOwner();
  const send = (actorId, message) => {
    const socket = getSocket(actorId);
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  };
  return {
    observeRawOverSocket(actorId, canObserve) {
      if (!actorId) throw new Error("comm.observe_raw requires a registered actorId");
      return subscriptions.once(`raw:${actorId}`, () =>
        observeRaw((envelope) => {
          if (canObserve(envelope)) send(actorId, { jsonrpc: "2.0", method: "comm.raw_envelope", params: envelope });
        }),
      );
    },
    hasPlan: (namespace) => stateOwner.hasPlan(namespace),
    registerPlan: (namespace, members) => stateOwner.registerPlan(namespace, members),
    lifecycleUpdate: (actorId, namespace, state) => stateOwner.update(namespace, actorId, state),
    stateSnapshot: (namespace) => stateOwner.snapshot(namespace),
    // Per actor and namespace, so Main can observe concurrent runs.
    observeStateOverSocket(actorId, namespace) {
      if (!actorId) throw new Error("comm.observe_state requires a registered actorId");
      return subscriptions.once(`state:${actorId}:${namespace}`, () =>
        stateOwner.subscribe(namespace, (nodes) =>
          send(actorId, { jsonrpc: "2.0", method: "comm.state_update", params: { namespace, nodes } }),
        ),
      );
    },
    release: (actorId) =>
      subscriptions.release((key) => key === `raw:${actorId}` || key.startsWith(`state:${actorId}:`)),
  };
}
