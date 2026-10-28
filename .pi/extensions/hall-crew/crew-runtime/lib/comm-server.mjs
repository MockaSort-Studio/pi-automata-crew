import { randomUUID } from "node:crypto";
import { startAdapters } from "./adapter-host.mjs";
import { CommController } from "./comm-controller.mjs";
import { watchParent } from "./parent-watch.mjs";

const config = JSON.parse(process.argv[2] ?? "{}");
const authToken = randomUUID();
const controller = new CommController({ authToken });
const port = await controller.start();
const stopAdapters = await startAdapters(controller, config.adapters);
process.stdout.write(`${JSON.stringify({ port, authToken })}\n`);
const shutdown = async () => {
  await stopAdapters();
  await controller.stop();
  process.exit(0);
};
process.once("SIGTERM", shutdown);
watchParent(config.hostPid, shutdown);
