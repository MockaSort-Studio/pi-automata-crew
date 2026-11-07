import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { findHostPi } from "./pi-host.mjs";

const here = (name) => new URL(name, import.meta.url).pathname;
const TAIL_BYTES = 4000;

// Main's side of the crew host: starts the process on first use, correlates requests with responses, and
// hands events to the caller. If the host dies, pending requests fail with what it last said; the next
// request starts a fresh host (crews that were running are gone, their salvaged branches are not).
export function createHostClient({
  env = process.env,
  cwd = process.cwd(),
  logFile,
  onEvent = () => {},
  onExit = () => {},
  spawnImpl = spawn,
  hostPi = findHostPi(),
} = {}) {
  let child;
  let nextId = 1;
  let buffer = "";
  let tail = "";
  const pending = new Map();

  function log(chunk) {
    if (!logFile) return;
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, chunk);
    } catch {}
  }

  function start() {
    if (child) return child;
    const spawned = spawnImpl(process.execPath, ["--import", here("pi-resolve-register.mjs"), here("host-main.mjs")], {
      cwd,
      // Its own process group: a Ctrl+C aimed at Main's terminal must not kill running crews. Its lifetime is
      // tied to Main by the stdin pipe instead.
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...env, ...(hostPi ? { CREW_PI_PARENT_URL: hostPi } : {}) },
    });
    child = spawned;
    spawned.stdin.on("error", () => {});
    spawned.stderr.on("data", (chunk) => {
      tail = (tail + chunk).slice(-TAIL_BYTES);
      log(chunk);
    });
    spawned.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === undefined) {
          // A handler's failure must never become an uncaught exception in Main (this is its data callback).
          try {
            onEvent(message);
          } catch (error) {
            log(`event handler failed: ${error?.stack ?? error}\n`);
          }
        } else {
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          if (message.ok) waiter?.resolve(message.result);
          else waiter?.reject(new Error(message.error?.message ?? "Crew host error"));
        }
      }
    });
    spawned.once("exit", (code, signal) => {
      if (child === spawned) child = undefined;
      buffer = "";
      const reason = `The crew host exited (${signal ?? `code ${code}`})${tail.trim() ? `: ${tail.trim().split("\n").slice(-3).join(" | ")}` : ""}`;
      for (const waiter of pending.values()) waiter.reject(new Error(reason));
      pending.clear();
      try {
        onExit({ code, signal, tail });
      } catch (error) {
        log(`exit handler failed: ${error?.stack ?? error}\n`);
      }
    });
    return spawned;
  }

  return {
    get running() {
      return Boolean(child);
    },
    get pid() {
      return child?.pid;
    },
    request(method, params = {}) {
      const target = start();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        target.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
          if (error) {
            pending.delete(id);
            reject(error);
          }
        });
      });
    },
    // Closing stdin is the stop command: the host closes every VM and exits.
    stop() {
      const target = child;
      if (!target) return Promise.resolve();
      return new Promise((resolve) => {
        target.once("exit", resolve);
        target.stdin.end();
      });
    },
  };
}
