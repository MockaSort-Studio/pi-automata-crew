import { WebSocketServer } from "ws";
import { LifecycleController } from "./lifecycle-controller.mjs";
import { watchParent } from "./parent-watch.mjs";

const config = JSON.parse(process.argv[2]);
const controller = new LifecycleController(config);
const authToken = config.authToken;
const server = new WebSocketServer({ port: 0 });
await new Promise((resolve) => server.once("listening", resolve));
const methods = {
  "lifecycle.spawn": (p) => controller.spawn(p),
  "lifecycle.list": () => controller.list(),
  "lifecycle.inspect": (p) => controller.inspect(p.id),
  "lifecycle.remove": (p) => controller.remove(p.id),
  "lifecycle.shutdown": () => controller.shutdown(),
};
server.on("connection", (socket) =>
  socket.on("message", async (raw) => {
    let request;
    try {
      request = JSON.parse(String(raw));
      if (!request || typeof request.method !== "string") throw Error("Invalid request");
      if (authToken && request.params?.authToken !== authToken) throw Error("Lifecycle authentication required");
      const fn = methods[request.method];
      if (!fn) throw Error(`Unknown Lifecycle method: ${request.method}`);
      const { authToken: _authToken, ...params } = request.params ?? {};
      const result = await fn(params);
      if (request.id !== undefined && socket.readyState === socket.OPEN)
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    } catch (error) {
      if (request?.id !== undefined && socket.readyState === socket.OPEN)
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { message: String(error) } }));
    }
  }),
);

let stopping;
const shutdown = () => {
  if (stopping) return stopping;
  stopping = (async () => {
    await controller.shutdown();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
    process.exit(0);
  })();
  return stopping;
};
watchParent(config.hostPid, () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
