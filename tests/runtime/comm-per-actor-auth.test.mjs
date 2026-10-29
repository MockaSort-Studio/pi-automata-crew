import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import test from "node:test";
import WebSocket from "ws";
import { CommController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs";
import { connectComm } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-client.mjs";

// Per-actor Comm authentication: each actor (Main plus every registered Crew
// member) holds its own token, minted once and checked against the specific
// actorId a connecting socket claims -- not a single secret shared by the
// whole run. See comm-controller.mjs's registerConnection()/registerActor().

const receive = (socket) => new Promise((resolve) => socket.once("message", (raw) => resolve(JSON.parse(String(raw)))));
const register = (socket, params) => {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id: "register", method: "comm.register", params }));
  return receive(socket);
};
const open = async (port) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => socket.once("open", resolve));
  return socket;
};

test("a worker's own token is accepted; the wrong token for the same actor is rejected", async () => {
  const comm = new CommController({ authToken: "main-token" });
  comm.registerActor("worker-a", { token: "token-a" });
  const port = await comm.start();
  const wrong = await open(port);
  assert.match(
    (await register(wrong, { actorId: "worker-a", authToken: "wrong-token" })).error.message,
    /authentication/i,
  );
  wrong.close();
  const right = await open(port);
  assert.deepEqual(await register(right, { actorId: "worker-a", authToken: "token-a" }), {
    jsonrpc: "2.0",
    id: "register",
    result: { registered: "worker-a" },
  });
  right.close();
  await comm.stop();
});

test("worker A cannot connect claiming worker B's identity, even with A's own valid token", async () => {
  const comm = new CommController({ authToken: "main-token" });
  comm.registerActor("worker-a", { token: "token-a" });
  comm.registerActor("worker-b", { token: "token-b" });
  const port = await comm.start();
  const socket = await open(port);
  // Worker A tries to register as "worker-b" using the token it was actually issued.
  const response = await register(socket, { actorId: "worker-b", authToken: "token-a" });
  assert.match(response.error.message, /authentication/i);
  socket.close();
  // The real worker B, with its own token, still succeeds.
  const real = await open(port);
  assert.equal((await register(real, { actorId: "worker-b", authToken: "token-b" })).result.registered, "worker-b");
  real.close();
  await comm.stop();
});

test("impersonation of a live Crew peer is rejected even once that peer is connected", async () => {
  const comm = new CommController({ authToken: "main-token" });
  comm.registerActor("worker-a", { token: "token-a" });
  comm.registerActor("worker-b", { token: "token-b" });
  const port = await comm.start();
  const legitimate = await open(port);
  await register(legitimate, { actorId: "worker-b", authToken: "token-b" });
  const impostor = await open(port);
  const response = await register(impostor, { actorId: "worker-b", authToken: "token-a" });
  assert.match(response.error.message, /authentication|already connected/i);
  legitimate.close();
  impostor.close();
  await comm.stop();
});

test("the server overrides an envelope's from with the authenticated sender, ignoring any client-supplied value", async () => {
  const comm = new CommController({ authToken: "main-token" });
  comm.registerActor("worker-a", { token: "token-a" });
  comm.registerActor("worker-b", { token: "token-b" });
  const port = await comm.start();
  const sender = await open(port);
  await register(sender, { actorId: "worker-a", authToken: "token-a" });
  sender.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "emit",
      method: "comm.emit",
      // A spoofed "from" in the request params is not a field comm.emit even reads --
      // the dispatcher always uses the socket's own authenticated actorId.
      params: { to: "worker-b", from: "worker-b", payload: { marker: "spoofed" } },
    }),
  );
  await receive(sender);
  const delivered = comm.claim("worker-b");
  assert.equal(delivered.from, "worker-a", "from is always the authenticated sender, never client-supplied");
  sender.close();
  await comm.stop();
});

test("Runtime mints a distinct token per spawned actor, so one worker's config can never authenticate as another", async () => {
  const { Runtime } = await import("../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs");
  const runtime = new Runtime(process.cwd());
  const prefix = `tokens-${randomUUID()}`;
  try {
    const comm = await runtime.startComm([`${prefix}-a`, `${prefix}-b`]);
    const tokenA = runtime.actorTokens.get(`${prefix}-a`);
    const tokenB = runtime.actorTokens.get(`${prefix}-b`);
    assert.ok(tokenA && tokenB, "each actor is minted a token");
    assert.notEqual(tokenA, tokenB);
    assert.notEqual(tokenA, comm.authToken, "a worker token is never Main's own token");
    // B's own token works for B...
    const asB = await connectComm({ url: comm.url, actorId: `${prefix}-b`, authToken: tokenB });
    asB.close();
    // ...but A's token does not authenticate as B.
    await assert.rejects(connectComm({ url: comm.url, actorId: `${prefix}-b`, authToken: tokenA }), /authentication/i);
  } finally {
    await runtime.stop();
  }
});

test("with Comm auth on, an actor registered without a token cannot connect without credentials", async () => {
  const comm = new CommController({ authToken: "main-token" });
  comm.registerActor("legacy-actor", { role: "developer" });
  const port = await comm.start();
  const socket = await open(port);
  try {
    assert.match((await register(socket, { actorId: "legacy-actor" })).error.message, /authentication/i);
  } finally {
    socket.close();
    await comm.stop();
  }
});

test("the Comm connection info that launch writes to the roster and returns to the model carries no worker token", async () => {
  const { Runtime } = await import("../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs");
  const runtime = new Runtime(process.cwd());
  const actor = `roster-${randomUUID()}-a`;
  try {
    const info = await runtime.startComm([actor]);
    const workerToken = runtime.actorTokens.get(actor);
    assert.ok(workerToken);
    assert.ok(!JSON.stringify(info).includes(workerToken), "worker token leaked into the roster-bound comm info");
  } finally {
    await runtime.stop();
  }
});
