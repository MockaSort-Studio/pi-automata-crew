const humanMessage = (payload) => {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const decoded = JSON.parse(trimmed);
        if (decoded && typeof decoded === "object") return humanMessage(decoded);
      } catch {
        // not JSON; fall through to the raw string
      }
    }
    return trimmed;
  }
  if (!payload || typeof payload !== "object") return "";
  for (const field of ["message", "summary", "report", "content", "finding", "findings", "evidence"]) {
    const value = payload[field];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const text = value.map(humanMessage).filter(Boolean).join("\n\n");
      if (text) return text;
    }
  }
  return "";
};

// Adapters (Discussion, Telegram, ...) see only this narrow, human-readable
// projection. Internal runtime observers (e.g. a future dependency ledger)
// need the raw envelope, including payload kind and kickoff assignments,
// so they subscribe separately via CommEnvelopeObservation#observe.
export function projectEnvelope(envelope) {
  const message = humanMessage(envelope.payload);
  if (!message) return null;
  return {
    id: envelope.id,
    kind: envelope.kind,
    from: envelope.from,
    to: envelope.to,
    message,
    replyTo: envelope.replyTo,
  };
}

export class CommEnvelopeObservation {
  #events = [];
  #subscribers = new Set();
  record(type, details) {
    this.#events.push({ type, at: new Date().toISOString(), ...details });
  }
  events() {
    return this.#events;
  }
  observe(handler) {
    this.#subscribers.add(handler);
    return () => this.#subscribers.delete(handler);
  }
  publish(envelope) {
    for (const subscriber of this.#subscribers) Promise.resolve(subscriber(envelope)).catch(() => {});
  }
}
