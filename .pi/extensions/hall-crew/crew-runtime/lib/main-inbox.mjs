import { createMainDeliveryNotifier } from "./main-delivery-notifier.mjs";

// Main's mailbox. With a Pi session attached each delivery starts a turn instead of waiting to
// be polled; either way it stays pending until Main replies or acknowledges it.
export class MainInbox {
  #queued = [];
  #pending = new Map();
  #notify;

  attach(sendMessage) {
    this.#notify = createMainDeliveryNotifier(sendMessage);
    return () => {
      this.#notify = undefined;
    };
  }

  deliver(message) {
    if (!this.#notify) return this.#queued.push(message);
    this.#pending.set(message.id, message);
    this.#notify(message);
  }

  next() {
    const message = this.#queued.shift();
    if (message) this.#pending.set(message.id, message);
    return message;
  }

  // Main deliveries are acknowledged by the broker on delivery; this only retires the local entry.
  acknowledge(messageId) {
    if (!this.#pending.delete(messageId)) throw new Error("Unknown Main delivery");
    return { acknowledged: true };
  }

  async reply(messageId, payload, emit) {
    const message = this.#pending.get(messageId);
    if (!message) throw new Error("Unknown Main delivery");
    if (!message.replyRequired) throw new Error("Main delivery does not require a reply");
    const result = await emit({ to: message.from, payload, replyTo: message.id });
    this.acknowledge(messageId);
    return result;
  }

  reset() {
    this.#queued = [];
  }
}
