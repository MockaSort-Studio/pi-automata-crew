// Preloaded (--import) by the crew host. CREW_PI_PARENT_URL names a file inside the user's Pi package.
import { register } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const parent = process.env.CREW_PI_PARENT_URL;
if (parent) {
  const tree = pathToFileURL(`${dirname(fileURLToPath(parent))}/`).href;
  register("./pi-resolve-hooks.mjs", { parentURL: import.meta.url, data: { parent, tree } });
}
