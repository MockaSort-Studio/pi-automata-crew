import { spawnSync } from "node:child_process";

export function skipWithoutGit(t, spawn = spawnSync) {
  const result = spawn("git", ["--version"]);
  if (result.error?.code === "ENOENT") {
    t.skip("git executable is not available on this runner");
    return true;
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git --version failed (status ${result.status}, signal ${result.signal})`);
  return false;
}
