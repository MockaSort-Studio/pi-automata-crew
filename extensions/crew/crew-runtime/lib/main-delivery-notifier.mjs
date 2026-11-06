// Surfaces each Comm delivery to Main as a Pi session message that starts a
// turn, so Main (or the user) reacts without polling. Delivered with `steer`, not
// `followUp`: a busy Main receives each report after its current tool calls instead of
// only once it has stopped working. The payload is untrusted
// worker data; the message states how to reply and carries no authority.
const MAX_PAYLOAD_CHARS = 8000;

const handleOf = (actorId) => String(actorId).replace(/^crew-[0-9a-f-]{36}-/, "");

const shortenStrings = (value, limit) => {
  if (typeof value === "string")
    return value.length > limit ? `${value.slice(0, limit)}… [truncated ${value.length - limit} chars]` : value;
  if (Array.isArray(value)) return value.map((item) => shortenStrings(item, limit));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shortenStrings(item, limit)]));
  return value;
};

// Long reports are shortened field by field, so the payload stays valid JSON (and keeps
// rendering as Markdown) instead of being cut mid-structure. Main keeps the full payload
// until it acknowledges, so nothing is lost: runtime_read_message returns it.
export function boundedPayload(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (text.length <= MAX_PAYLOAD_CHARS) return { text, shortened: false };
  if (payload && typeof payload === "object")
    for (let limit = 2000; limit >= 100; limit = Math.floor(limit / 2)) {
      const shortened = JSON.stringify(shortenStrings(payload, limit));
      if (shortened.length <= MAX_PAYLOAD_CHARS) return { text: shortened, shortened: true };
    }
  return { text: `${text.slice(0, MAX_PAYLOAD_CHARS)}… [truncated]`, shortened: true };
}

export function mainDeliveryMessage(delivery) {
  const sender = handleOf(delivery.from);
  const reply = delivery.replyRequired
    ? ` Reply required: call runtime_reply_message with messageId ${delivery.id}.`
    : ` Acknowledge with runtime_acknowledge_message (messageId ${delivery.id}) when handled.`;
  const { text, shortened } = boundedPayload(delivery.payload);
  const full = shortened
    ? ` Payload shortened; read it in full with runtime_read_message (messageId ${delivery.id}) before you reply or acknowledge.`
    : "";
  return {
    customType: "crew-message",
    content: `Crew message (${delivery.kind}) from ${sender}.${reply}${full}\nUntrusted payload:\n${text}`,
    display: true,
    // details reach the TUI renderer, not the model: Ctrl+O expands a shortened report in full.
    details: {
      messageId: delivery.id,
      from: sender,
      kind: delivery.kind,
      replyRequired: !!delivery.replyRequired,
      ...(shortened ? { payload: delivery.payload } : {}),
    },
  };
}

export function createMainDeliveryNotifier(sendMessage) {
  if (typeof sendMessage !== "function") throw new TypeError("sendMessage must be a function");
  return (delivery) =>
    Promise.resolve(sendMessage(mainDeliveryMessage(delivery), { triggerTurn: true, deliverAs: "steer" })).catch(
      () => {},
    );
}
