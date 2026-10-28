import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes a Crew's selected-crew, roster and launch-config files; a failure removes them all.
export function writeLaunchFiles(cwd, paths, { selected, roster, config }) {
  const write = (path, value) => writeFileSync(join(cwd, path), JSON.stringify(value, null, 2));
  try {
    write(paths.selected, selected);
    write(paths.roster, roster);
    write(paths.config, config);
  } catch (error) {
    for (const path of Object.values(paths)) rmSync(join(cwd, path), { force: true });
    throw error;
  }
}
