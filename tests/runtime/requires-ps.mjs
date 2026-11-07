import { spawnSync } from "node:child_process";

export function skipWithoutWidePs(t, spawn = spawnSync) {
  const result = spawn("ps", ["-ww", "-p", String(process.pid), "-o", "command="], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 0) return false;
  if (result.status === 1 && /^ps: unrecognized option: w\b/m.test(result.stderr ?? "")) {
    t.skip("ps -ww -p <pid> -o command= is not supported on this runner");
    return true;
  }
  throw new Error(
    `ps capability probe failed (status ${result.status}, signal ${result.signal}): ${result.stderr ?? ""}`,
  );
}
