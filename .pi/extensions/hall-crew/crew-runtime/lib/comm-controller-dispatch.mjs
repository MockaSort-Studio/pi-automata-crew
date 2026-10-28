// RPC method dispatch for one CommController WS connection, extracted so
// comm-controller.mjs's socket wiring stays focused on connection lifecycle
// (registration bookkeeping, cleanup on close) rather than the growing list
// of comm.* methods themselves. `state` is the one mutable per-socket slot
// (`actorId`, assigned by comm.register) that both this dispatcher and the
// caller's close handler need to see.
function dispatchCommRequest(controller, socket, state, request) {
  const { method, params } = request;
  if (method === "comm.register") {
    if (state.actorId) throw new Error("Actor already registered");
    state.actorId = params.actorId;
    controller.registerConnection(state.actorId, socket, params.namespace, params.authToken);
    return { registered: state.actorId };
  }
  if (method === "comm.register_actor") {
    if (state.actorId !== "main") throw new Error("Only Main may register actors");
    controller.registerActor(params.actorId, { role: params.role });
    return { registered: params.actorId };
  }
  if (method === "comm.ready") {
    if (!state.actorId || state.actorId === "main") throw new Error("Only a registered worker may become ready");
    return controller.markReady(state.actorId, params.namespace);
  }
  if (method === "comm.wait_ready") {
    if (state.actorId !== "main") throw new Error("Only Main may wait for readiness");
    return controller.waitReady(params.namespace, params.actorIds, params.timeoutMs);
  }
  if (method === "comm.broadcast") {
    if (!state.actorId) throw new Error("Registered actor identity required");
    if (state.actorId !== "main" && !params.namespace) throw new Error("Namespace required");
    return controller.broadcast(state.actorId, params.namespace, params.payload);
  }
  if (method === "comm.assign") {
    if (!state.actorId) throw new Error("Registered actor identity required");
    return controller.assign(state.actorId, params.namespace, params.to, params.note);
  }
  if (method === "comm.emit") {
    if (!state.actorId) throw new Error("Registered actor identity required");
    return controller.emit(state.actorId, params.to, params.payload, params.replyRequired, params.replyTo);
  }
  if (method === "comm.claim") {
    if (state.actorId !== params.actorId) throw new Error("Cannot claim another actor's mailbox");
    return controller.claim(params.actorId);
  }
  if (method === "comm.ack") return controller.acknowledge(state.actorId, params.messageId);
  if (method === "comm.inspect") {
    if (state.actorId !== "main") throw new Error("Only Main may inspect Comm");
    return controller.events();
  }
  if (method === "comm.observe_raw") return controller.observeRawOverSocket(state.actorId);
  if (method === "comm.register_plan") {
    if (state.actorId !== "main") throw new Error("Only Main may register plans");
    return controller.registerPlan(params.namespace, params.members);
  }
  if (method === "comm.lifecycle_update")
    return controller.lifecycleUpdate(state.actorId, params.namespace, params.state);
  if (method === "comm.state_snapshot") return controller.stateSnapshot(state.actorId, params.namespace);
  if (method === "comm.observe_state") return controller.observeStateOverSocket(state.actorId, params.namespace);
  return undefined;
}

// One Comm WebSocket: each request is dispatched and answered; closing releases the actor.
export function attachCommSocket(controller, socket) {
  const state = { actorId: undefined };
  const respond = (body) => socket.send(JSON.stringify({ jsonrpc: "2.0", ...body }));
  socket.on("message", async (raw) => {
    const request = JSON.parse(String(raw));
    try {
      respond({ id: request.id, result: await dispatchCommRequest(controller, socket, state, request) });
    } catch (error) {
      respond({ id: request.id, error: { message: String(error) } });
    }
  });
  socket.once("close", () => {
    if (state.actorId) controller.disconnect(state.actorId);
  });
}
