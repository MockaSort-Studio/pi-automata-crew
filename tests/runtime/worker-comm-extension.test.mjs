import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CommController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs";
import { isDegenerateTurn } from "../../.pi/extensions/hall-crew/crew-runtime/lib/degenerate-turn.mjs";
import { STATIC_CONTEXT_MARKER } from "../../.pi/extensions/hall-crew/crew-runtime/lib/worker-events.mjs";

const loadExtension = async (config) => {
  const dir = mkdtempSync(join(tmpdir(), "worker-comm-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(config));
  process.env.PI_CREW_WORKER_CONFIG = configPath;
  const module = await import(
    `../../.pi/extensions/hall-crew/crew-runtime/lib/worker-comm-extension.mjs?t=${Date.now()}-${Math.random()}`
  );
  return module.default;
};
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for delivery");
};
const makeFakePi = () => {
  const handlers = new Map(),
    tools = new Map(),
    deliveries = [];
  return {
    handlers,
    tools,
    deliveries,
    on: (event, handler) => handlers.set(event, handler),
    registerTool: (tool) => tools.set(tool.name, tool),
    sendUserMessage: async (message) => deliveries.push(message),
  };
};
async function setup(t, commTools, actorId = "ns-worker") {
  const comm = new CommController();
  comm.registerActor("lead");
  comm.registerActor(actorId);
  // Mirrors what Runtime.launchCrew always does in production immediately
  // after registering actors: without this, CommController's namespace map
  // stays empty and every lifecycleUpdate call (the onDelivery path every
  // real delivery goes through) throws "Cross-Crew namespace access is
  // forbidden" -- not a scenario this suite intends to exercise here.
  // registerPlan's members list is validated as role-persona handles
  // ("role-name-NN"), independent of the actorId under test -- a fixed
  // placeholder is enough to populate the namespace map.
  comm.registerPlan("ns", [{ handle: "developer-worker-00", dependsOn: [], task: "" }]);
  const port = await comm.start();
  const extension = await loadExtension({
    comm: { url: `ws://127.0.0.1:${port}`, actorId, namespace: "ns" },
    initialTurn: "resident",
    task: "",
    commTools,
  });
  const pi = makeFakePi();
  extension(pi);
  await pi.handlers.get("session_start")();
  t.after(async () => {
    await pi.handlers.get("session_shutdown")({ reason: "quit" });
    await comm.stop();
  });
  return { comm, pi };
}
test("lifecycle_update changes only this worker's typed state", async (t) => {
  const { comm, pi } = await setup(t, undefined, "ns-developer-worker-00");
  const update = await pi.tools.get("lifecycle_update").execute("call", { state: "running" });
  assert.match(JSON.stringify(update), /updated/);
  assert.equal(comm.stateSnapshot("ns-developer-worker-00", "ns").nodes[0].status, "running");
});

test("manifest kickoff is acknowledged without a model turn", async (t) => {
  const { comm, pi } = await setup(t);
  comm.emit("lead", "ns-worker", { kind: "kickoff", phase: "manifest", members: [] });
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
  assert.equal(pi.deliveries.length, 0);
});
test("comm_notify to main reaches main directly, unprefixed", async (t) => {
  const { comm, pi } = await setup(t, ["comm_notify", "comm_request", "comm_reply"]);
  const notify = await pi.tools.get("comm_notify").execute("call", { to: "main", payload: { ok: true } });
  assert.doesNotMatch(JSON.stringify(notify), /Unknown recipient/);
  const delivered = comm.claim("main");
  assert.equal(delivered?.to, "main");
  assert.equal(delivered?.from, "ns-worker");
});
test("acknowledges only after the Pi turn settles", async (t) => {
  const { comm, pi } = await setup(t);
  comm.emit("lead", "ns-worker", { ask: "respond" }, true);
  await waitFor(() => pi.deliveries.length === 1);
  assert.equal(
    comm.events().some((event) => event.type === "message_acknowledged"),
    false,
  );
  await pi.tools.get("comm_reply").execute("call", { payload: { ok: true } });
  await pi.handlers.get("agent_settled")();
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
});
test("keeps reply context for the current delivery", async (t) => {
  const { comm, pi } = await setup(t);
  const first = comm.emit("lead", "ns-worker", { ask: "first" }, true);
  await waitFor(() => pi.deliveries.length === 1);
  await pi.tools.get("comm_reply").execute("call", { payload: { marker: "first" } });
  await waitFor(() => comm.events().some((event) => event.replyTo === first.id));
  await pi.handlers.get("agent_settled")();
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
  comm.emit("lead", "ns-worker", { ask: "second" }, true);
  await waitFor(() => pi.deliveries.length === 2);
  const reply = await pi.tools.get("comm_reply").execute("call", { payload: { marker: "second" } });
  assert.doesNotMatch(JSON.stringify(reply), /does not require a reply/);
  await pi.handlers.get("agent_settled")();
});
test("specialists never receive comm_notify_all or comm_notify_many", async (t) => {
  const { pi } = await setup(t, ["comm_notify", "comm_request", "comm_reply"]);
  assert.ok(pi.tools.has("comm_notify"));
  assert.ok(!pi.tools.has("comm_notify_all"));
  assert.ok(!pi.tools.has("comm_notify_many"));
});
test("only a lead-granted worker receives comm_notify_all", async (t) => {
  const { pi } = await setup(t, ["comm_notify", "comm_notify_all", "comm_request", "comm_reply"]);
  assert.ok(pi.tools.has("comm_notify_all"));
  assert.ok(!pi.tools.has("comm_notify_many"));
});
test("isDegenerateTurn flags zero tokens and zero tool calls, nothing else", () => {
  assert.equal(isDegenerateTurn({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 0), true);
  assert.equal(isDegenerateTurn({ input: 0, output: 3, cacheRead: 0, cacheWrite: 0 }, 0), false);
  assert.equal(isDegenerateTurn(undefined, 1), false);
});
const fireTurn = (pi, { usage, toolCalls = 0 } = {}) => {
  pi.handlers.get("turn_end")({
    message: { usage, content: Array.from({ length: toolCalls }, () => ({ type: "toolCall" })) },
  });
  pi.handlers.get("agent_settled")();
};
test("a delivery that settles without any turn_end (e.g. reply-driven) is never treated as degenerate", async (t) => {
  const { comm, pi } = await setup(t);
  comm.emit("lead", "ns-worker", { ask: "respond" }, true);
  await waitFor(() => pi.deliveries.length === 1);
  await pi.tools.get("comm_reply").execute("call", { payload: { ok: true } });
  pi.handlers.get("agent_settled")();
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
  assert.equal(pi.deliveries.length, 1, "no retry when no turn_end fired at all");
});
test("acknowledges normally after one real turn, no retry", async (t) => {
  const { comm, pi } = await setup(t);
  comm.emit("lead", "ns-worker", { ask: "respond" }, true);
  await waitFor(() => pi.deliveries.length === 1);
  fireTurn(pi, { usage: { input: 2, output: 5 }, toolCalls: 1 });
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
  assert.equal(pi.deliveries.length, 1, "no retry for a real turn");
});
test("retries exactly once on a degenerate turn, then acknowledges once real work follows", async (t) => {
  const { comm, pi } = await setup(t);
  comm.emit("lead", "ns-worker", { ask: "respond" }, true);
  await waitFor(() => pi.deliveries.length === 1);
  fireTurn(pi, { usage: { input: 0, output: 0 }, toolCalls: 0 });
  await waitFor(() => pi.deliveries.length === 2);
  fireTurn(pi, { usage: { input: 2, output: 5 }, toolCalls: 1 });
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
  assert.equal(pi.deliveries.length, 2, "exactly one retry, not a loop");
  assert.equal(
    comm
      .events()
      .some((event) => event.to === "main" && event.type === "message_emitted" && event.from === "ns-worker"),
    false,
    "no BLOCKED report when the retry succeeds",
  );
});
test("reports BLOCKED to main and still acknowledges after two consecutive degenerate turns", async (t) => {
  const { comm, pi } = await setup(t);
  comm.emit("lead", "ns-worker", { ask: "respond" }, true);
  await waitFor(() => pi.deliveries.length === 1);
  fireTurn(pi, { usage: { input: 0, output: 0 }, toolCalls: 0 });
  await waitFor(() => pi.deliveries.length === 2);
  fireTurn(pi, { usage: { input: 0, output: 0 }, toolCalls: 0 });
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
  assert.equal(pi.deliveries.length, 2, "never a third attempt: bounded, not a loop");
  const report = comm.claim("main");
  assert.equal(report?.from, "ns-worker");
  assert.equal(report?.payload?.status, "BLOCKED");
  assert.equal(report?.payload?.reason, "empty-turn");
});
test("a same-process reload (new_session) never races a second Comm registration, and never calls a stale pi", async (t) => {
  const comm = new CommController();
  comm.registerActor("lead");
  comm.registerActor("ns-worker");
  comm.registerPlan("ns", [{ handle: "developer-worker-00", dependsOn: [], task: "" }]);
  const port = await comm.start();
  const extension = await loadExtension({
    comm: { url: `ws://127.0.0.1:${port}`, actorId: "ns-worker", namespace: "ns" },
    initialTurn: "first-delivery",
    resident: true,
    task: "",
  });
  // Reproduces worker.mjs's new_session flow verbatim, including the part a
  // same-`pi`-object test would mask: pi's reload contract replaces `pi`
  // with a genuinely new instance and calling the old one afterward is
  // documented as invalid ("ctx is stale after session replacement or
  // reload"), which is exactly what crashed the real worker process before
  // this fix. session_start on pi1 fires, and before its connectComm() has
  // resolved, a same-process reload fires session_shutdown on pi1 then
  // rebinds the whole extension against a fresh pi2.
  const pi1 = makeFakePi();
  extension(pi1);
  const first = pi1.handlers.get("session_start")();
  const shutdown = pi1.handlers.get("session_shutdown")({ reason: "new" });
  const pi2 = makeFakePi();
  extension(pi2);
  const second = pi2.handlers.get("session_start")();
  await Promise.all([first, shutdown, second]);

  comm.emit("lead", "ns-worker", { ask: "respond" }, true);
  await waitFor(() => pi1.deliveries.length + pi2.deliveries.length === 1);
  assert.equal(pi1.deliveries.length, 0, "the stale pre-reload pi is never called");
  assert.equal(pi2.deliveries.length, 1, "the delivery reaches the current, post-reload pi exactly once");
  fireTurn(pi2, { usage: { input: 2, output: 5 }, toolCalls: 1 });
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));

  t.after(async () => {
    await pi2.handlers.get("session_shutdown")({ reason: "quit" });
    await comm.stop();
  });
});
test("a non-quit shutdown (reload/new) never closes the live Comm connection", async (t) => {
  const { comm, pi } = await setup(t);
  await pi.handlers.get("session_shutdown")({ reason: "new" });
  comm.emit("lead", "ns-worker", { ask: "still alive" }, true);
  await waitFor(() => pi.deliveries.length === 1);
  fireTurn(pi, { usage: { input: 2, output: 5 }, toolCalls: 1 });
  await waitFor(() => comm.events().some((event) => event.type === "message_acknowledged"));
});
test("agent_start records content-free static-context token counts exactly once", async () => {
  const extension = await loadExtension({ initialTurn: "resident", task: "" });
  const notified = [];
  const pi = {
    on: (event, handler) => (pi.handlers ??= new Map()).set(event, handler),
    handlers: new Map(),
    registerTool: () => {},
    getActiveTools: () => ["bash"],
    getAllTools: () => [
      { name: "bash", parameters: { type: "object" } },
      { name: "read", parameters: { type: "object" } },
    ],
  };
  extension(pi);
  const ctx = {
    getSystemPrompt: () => "You are a careful agent.",
    ui: { notify: (message) => notified.push(message) },
  };
  pi.handlers.get("agent_start")({}, ctx);
  pi.handlers.get("agent_start")({}, ctx);
  assert.equal(notified.length, 1, "static context is reported once per worker, not once per turn");
  assert.ok(notified[0].startsWith(STATIC_CONTEXT_MARKER));
  const tokens = JSON.parse(notified[0].slice(STATIC_CONTEXT_MARKER.length));
  assert.ok(tokens.systemPrompt > 0);
  assert.ok(tokens.toolSchemas > 0);
  assert.equal(
    JSON.stringify(tokens).includes("careful agent"),
    false,
    "only token counts are recorded, never prompt text",
  );
});

test("only a Lead-granted worker receives crew_assign", async (t) => {
  const { pi: specialist } = await setup(t, ["comm_notify", "comm_request", "comm_reply"]);
  assert.ok(!specialist.tools.has("crew_assign"));
  const { pi: lead } = await setup(t, ["comm_notify", "crew_assign", "comm_request", "comm_reply"]);
  assert.ok(lead.tools.has("crew_assign"));
});
