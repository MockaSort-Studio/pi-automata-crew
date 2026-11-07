// Preloaded (--import) by the crew host. CREW_PI_PARENT_URL names a file inside the user's Pi package.
//
// The extension declares Pi's packages as peers (the user's Pi provides them); a separate process has no such
// provider, so a bare import of one of them from outside Pi's own tree is resolved from Pi's install instead.
// Only Pi's peers are redirected: this extension's own dependencies (Gondolin, ...) resolve normally, and so
// does everything inside Pi's tree.
import { registerHooks } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PI_PEER = /^(@earendil-works\/pi-[a-z-]+|typebox)(\/|$)/;
const parent = process.env.CREW_PI_PARENT_URL;
if (parent) {
  const tree = pathToFileURL(`${dirname(fileURLToPath(parent))}/`).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (PI_PEER.test(specifier) && !context.parentURL?.startsWith(tree))
        return nextResolve(specifier, { ...context, parentURL: parent });
      return nextResolve(specifier, context);
    },
  });
}
