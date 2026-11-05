import { randomUUID } from "node:crypto";

// Per-actor message queues. A specialist has at most one in-flight delivery, which is
// acknowledged after its turn settles; Main and the Lead drain their queue in order instead.
export class Mailbox {
  #queues = new Map();
  #inflight = new Map();

  queue(actorId) {
    if (!this.#queues.has(actorId)) this.#queues.set(actorId, []);
    return this.#queues.get(actorId);
  }

  push(actorId, message) {
    this.queue(actorId).push(message);
  }

  hasInflight = (actorId) => this.#inflight.has(actorId);

  claim(actorId) {
    if (this.#inflight.has(actorId)) return undefined;
    const message = this.queue(actorId).shift();
    if (message) this.#inflight.set(actorId, message);
    return message;
  }

  acknowledge(actorId, messageId) {
    const message = this.#inflight.get(actorId);
    if (!message || message.id !== messageId) return undefined;
    this.#inflight.delete(actorId);
    return message;
  }

  release(actorId) {
    const message = this.#inflight.get(actorId);
    if (!message) return undefined;
    this.#inflight.delete(actorId);
    this.queue(actorId).unshift(message);
    return message;
  }
}

export const deliveryMetrics = (message) => ({
  messageId: message.id,
  from: message.from,
  to: message.to,
  payloadBytes: Buffer.byteLength(JSON.stringify(message.payload)),
  latencyMs: Date.now() - message.queuedAt,
});

export function buildEnvelope(from, to, payload, replyRequired, replyTo) {
  const queuedAt = Date.now();
  return {
    v: 1,
    id: randomUUID(),
    kind: replyTo ? "reply" : replyRequired ? "request" : "notify",
    from,
    to,
    payload,
    replyRequired,
    replyTo,
    createdAt: new Date(queuedAt).toISOString(),
    queuedAt,
  };
}
