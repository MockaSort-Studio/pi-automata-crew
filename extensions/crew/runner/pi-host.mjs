import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE = "@earendil-works/pi-coding-agent";

// The user's Pi package, found from the running Pi's own entry point (argv[1], through any symlink such as a
// global bin). Returns a file URL inside it, or undefined when this process is not running under an installed
// Pi (development), where ordinary resolution already finds the repository's own copy.
export function findHostPi(entry = process.argv[1]) {
  if (!entry) return undefined;
  let directory;
  try {
    directory = dirname(realpathSync(entry));
  } catch {
    return undefined;
  }
  for (let depth = 0; depth < 12; depth += 1) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, "utf8")).name === PACKAGE) return pathToFileURL(manifest).href;
      } catch {}
    }
    const up = dirname(directory);
    if (up === directory) break;
    directory = up;
  }
  return undefined;
}
