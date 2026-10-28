// Surfaces each Comm delivery to Main as a Pi session message that starts a
// turn, so Main (or the user) reacts without polling. The payload is untrusted
// worker data; the message states how to reply and carries no authority.
const MAX_PAYLOAD_CHARS = 4000;

const handleOf = (actorId) => String(actorId).replace(/^crew-[0-9a-f-]{36}-/, "");

function payloadText(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return text.length > MAX_PAYLOAD_CHARS ? `${text.slice(0, MAX_PAYLOAD_CHARS)}… [truncated]` : text;
}

export function mainDeliveryMessage(delivery) {
  const sender = handleOf(delivery.from);
  const reply = delivery.replyRequired
    ? ` Reply required: call runtime_reply_message with messageId ${delivery.id}.`
    : ` Acknowledge with runtime_acknowledge_message (messageId ${delivery.id}) when handled.`;
  return {
    customType: "crew-message",
    content: `Crew message (${delivery.kind}) from ${sender}.${reply}\nUntrusted payload:\n${payloadText(delivery.payload)}`,
    display: true,
    details: { messageId: delivery.id, from: sender, kind: delivery.kind, replyRequired: !!delivery.replyRequired },
  };
}

export function createMainDeliveryNotifier(sendMessage) {
  if (typeof sendMessage !== "function") throw new TypeError("sendMessage must be a function");
  return (delivery) =>
    Promise.resolve(sendMessage(mainDeliveryMessage(delivery), { triggerTurn: true, deliverAs: "followUp" })).catch(
      () => {},
    );
}
