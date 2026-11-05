import WebSocket from "ws";
export async function connectLifecycle(url, { timeoutMs = 30_000, authToken } = {}) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("Lifecycle connection closed")));
  });
  let sequence = 0;
  const pending = new Map();
  const fail = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("Lifecycle connection closed")));
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw)),
        entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    } catch {}
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== socket.OPEN) return reject(new Error("Lifecycle connection is closed"));
      const id = String(++sequence),
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Lifecycle RPC timed out: ${method}`));
        }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, authToken } }));
    });
  return {
    spawn: (params) => request("lifecycle.spawn", params),
    list: () => request("lifecycle.list"),
    inspect: (id) => request("lifecycle.inspect", { id }),
    remove: (id) => request("lifecycle.remove", { id }),
    shutdown: () => request("lifecycle.shutdown"),
    close: () => {
      fail(new Error("Lifecycle client closed"));
      socket.close();
    },
  };
}
