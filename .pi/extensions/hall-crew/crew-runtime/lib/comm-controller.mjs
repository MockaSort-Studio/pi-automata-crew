import { WebSocketServer } from "ws";
import { CommEnvelopeObservation, projectEnvelope } from "./comm-envelope-observation.mjs";
import { createCommObservers } from "./comm-controller-observers.mjs";
import { attachCommSocket } from "./comm-controller-dispatch.mjs";
import { CommAccess } from "./comm-access.mjs";
import { Mailbox, buildEnvelope, deliveryMetrics } from "./comm-mailbox.mjs";
import { planAssignment } from "./lead-assignment.mjs";
import { ReadyBarrier } from "./comm-readiness.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CommController {
  #server;
  #connections = new Map();
  #mailbox = new Mailbox();
  #assigned = new Set();
  #actors = new Set(["main"]);
  #access = new CommAccess();
  #pendingReplies = new Map();
  #ready = new ReadyBarrier();
  #actorRoles = new Map();
  #observation = new CommEnvelopeObservation();
  #observers = createCommObservers({
    observeRaw: (handler) => this.observeRaw(handler),
    getSocket: (actorId) => this.#connections.get(actorId),
  });
  // Staggered broadcast avoids simultaneous worker startup collisions.
  #broadcastStaggerMs;
  #authToken;
  constructor({ broadcastStaggerMs = 250, authToken } = {}) {
    this.#broadcastStaggerMs = broadcastStaggerMs;
    this.#authToken = authToken;
  }
  async start(port = 0) {
    this.#server = new WebSocketServer({ port });
    await new Promise((resolve) => this.#server.once("listening", resolve));
    this.#server.on("connection", (socket) => attachCommSocket(this, socket));
    return this.#server.address().port;
  }
  // Terminate every socket, then bound the close, so a dead peer cannot keep Comm alive.
  async stop() {
    for (const socket of this.#server.clients) socket.terminate();
    await Promise.race([
      new Promise((resolve) => this.#server.close(resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  registerActor(actorId, { role } = {}) {
    if (!actorId || actorId === "main") throw new Error("Cannot register reserved actor");
    this.#actors.add(actorId);
    if (role) this.#actorRoles.set(actorId, role);
    this.#mailbox.queue(actorId);
    this.#record("actor_registered", { actorId, role });
  }
  markReady(actorId, namespace) {
    this.#access.assertNamespace(actorId, namespace);
    this.#ready.mark(actorId);
    this.#record("worker_ready", { actorId, namespace });
    return { ready: true };
  }
  waitReady(namespace, actorIds, timeoutMs) {
    return this.#ready.wait(actorIds, timeoutMs);
  }
  emit(from, to, payload, replyRequired = false, replyTo) {
    const request = replyTo && this.#pendingReplies.get(replyTo);
    if (replyTo && !request) throw new Error("Unknown reply request");
    if (request && request.to !== from) throw new Error("Only the request recipient may reply");
    if (!this.#actors.has(to)) throw new Error(`Unknown recipient: ${to}`);
    this.#access.assertPeer(from, to);
    const message = buildEnvelope(from, to, payload, replyRequired, replyTo);
    this.#mailbox.push(to, message);
    if (replyRequired) this.#pendingReplies.set(message.id, message);
    if (replyTo) {
      this.#pendingReplies.delete(replyTo);
      this.#record("message_replied", {
        ...deliveryMetrics(message),
        replyTo,
        replyLatencyMs: Date.now() - request.queuedAt,
      });
    }
    this.#record("message_emitted", deliveryMetrics(message));
    this.#observation.publish(message);
    this.#flush(to);
    return { accepted: true, id: message.id };
  }
  assign(from, namespace, handle, note) {
    this.#access.assertNamespace(from, namespace);
    if (this.#actorRoles.get(from) !== "lead") throw new Error("Only the Crew Lead may assign work");
    const nodes = this.#observers.stateSnapshot(namespace)?.nodes ?? [];
    const { to, payload } = planAssignment({ from, namespace, handle, note, nodes, assigned: this.#assigned });
    const sent = this.emit(from, to, payload);
    this.#assigned.add(`${namespace}/${handle}`);
    return sent;
  }
  // Deliver recipients in registration order with a fixed gap.
  async broadcast(from, namespace, payload) {
    this.#access.assertNamespace(from, namespace);
    if (from !== "main" && this.#actorRoles.get(from) && this.#actorRoles.get(from) !== "lead")
      throw new Error("Only the Crew Lead may broadcast");
    // Broadcasts address the Crew only, never Main.
    const recipients = [...this.#actors].filter((id) => id.startsWith(`${namespace}-`) && id !== from);
    const ids = [];
    for (const [index, to] of recipients.entries()) {
      if (index > 0 && this.#broadcastStaggerMs > 0) await sleep(this.#broadcastStaggerMs);
      ids.push(this.emit(from, to, payload).id);
    }
    return { accepted: true, recipients: ids };
  }
  claim(actorId) {
    const message = this.#mailbox.claim(actorId);
    if (message) this.#record("message_claimed", deliveryMetrics(message));
    return message;
  }
  acknowledge(actorId, messageId) {
    const message = this.#mailbox.acknowledge(actorId, messageId);
    if (!message) return { acknowledged: false };
    this.#record("message_acknowledged", deliveryMetrics(message));
    this.#flush(actorId);
    return { acknowledged: true };
  }
  release(actorId) {
    const message = this.#mailbox.release(actorId);
    if (message) this.#record("message_requeued", deliveryMetrics(message));
  }
  events = () => this.#observation.events();
  subscribe(handler) {
    return this.#observation.observe((envelope) => {
      const projected = projectEnvelope(envelope);
      if (projected) return handler(projected);
    });
  }
  observeRaw = (handler) => this.#observation.observe(handler);
  injectHuman = ({ to, body, author, externalId }) =>
    this.emit("human:github-discussion", to, { message: body, author, externalId }, true);
  registerConnection(actorId, socket, namespace, authToken) {
    if (this.#authToken && authToken !== this.#authToken) throw new Error("Comm authentication required");
    if (actorId === "main" && this.#connections.has("main")) throw new Error("Main is already connected");
    const knownNamespace = this.#access.namespaceOf(actorId);
    const isObserver = actorId === `observer-${namespace}` && namespace;
    if (!this.#actors.has(actorId) && !isObserver) throw new Error("Actor is not authorized");
    if (knownNamespace && namespace !== knownNamespace) throw new Error("Cross-Crew namespace access is forbidden");
    if (this.#connections.has(actorId)) throw new Error("Actor already connected");
    if (isObserver) this.#access.assign(actorId, namespace);
    this.#connections.set(actorId, socket);
    this.#record("worker_registered", { actorId });
    setImmediate(() => this.#flush(actorId));
  }
  observeRawOverSocket(actorId) {
    return this.#observers.observeRawOverSocket(actorId, (envelope) => this.#access.canObserve(actorId, envelope));
  }
  registerPlan(namespace, members) {
    const result = this.#observers.registerPlan(namespace, members);
    for (const actorId of this.#actors)
      if (actorId.startsWith(`${namespace}-`)) this.#access.assign(actorId, namespace);
    return result;
  }
  lifecycleUpdate(actorId, namespace, state) {
    this.#access.assertNamespace(actorId, namespace);
    return this.#observers.lifecycleUpdate(actorId, namespace, state);
  }
  stateSnapshot(actorId, namespace) {
    this.#access.assertNamespace(actorId, namespace);
    return this.#observers.stateSnapshot(namespace);
  }
  observeStateOverSocket(actorId, namespace) {
    this.#access.assertNamespace(actorId, namespace);
    return this.#observers.observeStateOverSocket(actorId, namespace);
  }
  disconnect(actorId) {
    this.release(actorId);
    this.#connections.delete(actorId);
    this.#ready.clear(actorId);
    this.#observers.release(actorId);
    this.#record("worker_disconnected", { actorId });
  }
  // Main and the Lead receive every message in order as it arrives; delivery is their
  // acknowledgement. Specialists keep one in-flight delivery, acknowledged after their turn.
  #queued(actorId) {
    return actorId === "main" || this.#actorRoles.get(actorId) === "lead";
  }
  #flush(actorId) {
    const socket = this.#connections.get(actorId);
    if (!socket || socket.readyState !== 1) return;
    if (this.#queued(actorId)) {
      for (let message; (message = this.#mailbox.queue(actorId).shift()); ) {
        this.#record("message_claimed", deliveryMetrics(message));
        for (const type of ["message_delivered", "message_acknowledged"]) this.#record(type, deliveryMetrics(message));
        this.#deliver(socket, message);
      }
      return;
    }
    if (this.#mailbox.hasInflight(actorId)) return;
    const message = this.claim(actorId);
    if (!message) return;
    this.#record("message_delivered", deliveryMetrics(message));
    this.#deliver(socket, message);
  }
  #deliver = (socket, message) => socket.send(JSON.stringify({ jsonrpc: "2.0", method: "comm.deliver", params: message }));
  #record = (type, details) => this.#observation.record(type, details);
}
