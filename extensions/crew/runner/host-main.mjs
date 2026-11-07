// The crew host process: one per Main. Reads JSON-line commands on stdin, writes responses and events on
// stdout (stderr is diagnostics only). When stdin closes (Main exited or asked it to stop) every VM is
// closed and the process exits. If this process is killed outright, the VM guardian (vm-lifecycle.mjs)
// removes its VMs.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createHostCore } from "./host-core.mjs";

// When Main dies, stdout and stderr lose their reader. Writing to them must then be a silent no-op:
// reporting a failed write by writing again turns one broken pipe into an endless error storm that starves
// the event loop, so the host can never finish shutting down.
let stdioClosed = false;
const stdioBroken = () => {
  stdioClosed = true;
  shutdown(0);
};
const safeWrite = (stream, text) => {
  if (stdioClosed) return;
  try {
    stream.write(text);
  } catch {
    stdioClosed = true;
  }
};
const write = (message) => safeWrite(process.stdout, `${JSON.stringify(message)}\n`);
const log = (...parts) => safeWrite(process.stderr, `${new Date().toISOString()} ${parts.join(" ")}\n`);
for (const stream of [process.stdout, process.stderr, process.stdin]) {
  stream.on("error", stdioBroken);
  stream.on("close", () => stream === process.stdin || stdioBroken());
}

// Test seam only: a module whose default export replaces the host's outside-world dependencies.
const deps = process.env.CREW_HOST_DEPS ? (await import(pathToFileURL(process.env.CREW_HOST_DEPS).href)).default : {};
const core = createHostCore({ send: write, deps });

const pending = new Set();
let closing = false;
async function shutdown(code) {
  if (closing) return;
  closing = true;
  await Promise.allSettled([...pending]);
  await core.close();
  process.exit(code);
}

createInterface({ input: process.stdin })
  .on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return log("ignored a line that is not JSON");
    }
    const job = core.handle(message).finally(() => pending.delete(job));
    pending.add(job);
  })
  .on("close", () => shutdown(0));

for (const signal of ["SIGTERM", "SIGHUP"]) process.on(signal, () => shutdown(0));
process.on("uncaughtException", (error) => {
  log("uncaught exception:", error?.stack ?? error);
  shutdown(1);
});
process.on("unhandledRejection", (error) => log("unhandled rejection:", error?.stack ?? error));
log("crew host ready, pid", process.pid);
