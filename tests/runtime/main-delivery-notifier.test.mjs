import { strict as assert } from "node:assert";
import test from "node:test";
import { Runtime } from "../../extensions/crew/crew-runtime/lib/runtime.mjs";
import { connectComm } from "../../extensions/crew/crew-runtime/lib/comm-client.mjs";
import { mainDeliveryMessage } from "../../extensions/crew/crew-runtime/lib/main-delivery-notifier.mjs";

const runId = "22222222-2222-2222-2222-222222222222";
const namespace = `crew-${runId}`;
const actorId = `${namespace}-developer-snowball-00`;

test("message text names the sender, reply path, bounds untrusted payload, and carries no dispatch protocol", () => {
  const message = mainDeliveryMessage({
    id: "m1",
    from: actorId,
    kind: "request",
    replyRequired: true,
    payload: "x".repeat(9000),
  });
  assert.match(message.content, /from developer-snowball-00/);
  assert.match(message.content, /runtime_reply_message with messageId m1/);
  assert.match(message.content, /truncated/);
  assert.doesNotMatch(
    message.content,
    /DISPATCH PROTOCOL/,
    "the protocol belongs to user dispatch requests, not to worker messages",
  );
});

test("a long structured report stays valid JSON, so it still renders, and points to the full payload", () => {
  const diff = "line\n".repeat(4000);
  const message = mainDeliveryMessage({
    id: "m2",
    from: actorId,
    kind: "notify",
    payload: { status: "complete", changedFiles: ["a.mjs"], diff },
  });
  const payload = JSON.parse(message.content.split("Untrusted payload:\n")[1]);
  assert.equal(payload.status, "complete");
  assert.deepEqual(payload.changedFiles, ["a.mjs"]);
  assert.match(payload.diff, /truncated \d+ chars/);
  assert.match(message.content, /runtime_read_message \(messageId m2\)/);
  const short = mainDeliveryMessage({ id: "m3", from: actorId, kind: "notify", payload: { ok: true } });
  assert.doesNotMatch(short.content, /runtime_read_message/);
});

test("Main reads a shortened delivery in full until it is acknowledged", async (t) => {
  const runtime = new Runtime(process.cwd());
  const comm = await runtime.startComm([actorId], [], {
    namespace,
    members: [{ handle: "developer-snowball-00", dependsOn: [], task: "" }],
  });
  const worker = await connectComm({ url: comm.url, actorId, namespace, authToken: runtime.actorTokens.get(actorId) });
  t.after(async () => {
    worker.close();
    await runtime.stop();
  });
  const sent = [];
  runtime.attachMainDelivery((message) => sent.push(message));
  const diff = "x".repeat(20_000);
  await worker.emit({ to: "main", payload: { diff } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const { messageId } = sent[0].details;
  assert.equal((await runtime.readMain(messageId)).payload.diff, diff);
  await runtime.acknowledgeMain(messageId);
  await assert.rejects(runtime.readMain(messageId), /Unknown Main delivery/);
});

test("with a session attached every Main delivery starts a turn and stays replyable", async (t) => {
  const runtime = new Runtime(process.cwd());
  const comm = await runtime.startComm([actorId], [], {
    namespace,
    members: [{ handle: "developer-snowball-00", dependsOn: [], task: "" }],
  });
  const worker = await connectComm({ url: comm.url, actorId, namespace, authToken: runtime.actorTokens.get(actorId) });
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
  assert.ok(sent.every(({ options }) => options.triggerTurn && options.deliverAs === "steer"));
  assert.equal(await runtime.receive("main"), null);
  const replies = [];
  worker.onDelivery((message) => replies.push(message));
  await runtime.replyFromMain(request.id, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(replies[0].payload, { ok: true });
});
