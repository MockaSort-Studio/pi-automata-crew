import { strict as assert } from "node:assert";
import test from "node:test";
import { Runtime } from "../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs";
import { connectComm } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-client.mjs";
import { mainDeliveryMessage } from "../../.pi/extensions/hall-crew/crew-runtime/lib/main-delivery-notifier.mjs";

const runId = "22222222-2222-2222-2222-222222222222";
const namespace = `crew-${runId}`;
const actorId = `${namespace}-developer-snowball-00`;

test("message text names the sender, reply path, bounds untrusted payload, and carries no dispatch protocol", () => {
  const message = mainDeliveryMessage({ id: "m1", from: actorId, kind: "request", replyRequired: true, payload: "x".repeat(5000) });
  assert.match(message.content, /from developer-snowball-00/);
  assert.match(message.content, /runtime_reply_message with messageId m1/);
  assert.match(message.content, /truncated/);
  assert.doesNotMatch(message.content, /DISPATCH PROTOCOL/, "the protocol belongs to user dispatch requests, not to worker messages");
});

test("with a session attached every Main delivery starts a turn and stays replyable", async (t) => {
  const runtime = new Runtime(process.cwd());
  const comm = await runtime.startComm([actorId], [], { namespace, members: [{ handle: "developer-snowball-00", dependsOn: [], task: "" }] });
  const worker = await connectComm({ ...comm, actorId, namespace });
  t.after(async () => {
    worker.close();
    await runtime.stop();
  });
  const sent = [];
  runtime.attachMainDelivery((message, options) => sent.push({ message, options }));
  await worker.emit({ to: "main", payload: { n: 1 } });
  const request = await worker.emit({ to: "main", payload: { q: 2 }, replyRequired: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, 2);
  assert.ok(sent.every(({ options }) => options.triggerTurn && options.deliverAs === "followUp"));
  assert.equal(await runtime.receive("main"), null);
  const replies = [];
  worker.onDelivery((message) => replies.push(message));
  await runtime.replyFromMain(request.id, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(replies[0].payload, { ok: true });
});
