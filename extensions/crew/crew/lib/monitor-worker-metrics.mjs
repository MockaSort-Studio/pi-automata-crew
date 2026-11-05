// Reads each roster member's own content-free events.jsonl and reduces it
// to worker-metrics counts (turns/tool calls/provider traffic/session
// context). No pi-tui/pi-coding-agent import -- `configDirName` is passed
// in by the caller (monitor.ts already has CONFIG_DIR_NAME) instead of
// imported here, so this stays testable with plain `node --test` against a
// real temp directory, unlike the rest of monitor.ts's pi-tui-bound wiring.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeWorkerEvents } from "../../crew-runtime/lib/worker-metrics.mjs";

const readEvents = (path) => {
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

// Worker metrics live under each actor's own run directory for as long as
// it exists. A terminal member's directory may already be gone by the time
// this renders; summarizeWorkerEvents([]) degrades to all-zero counts.
export function workerMetricsByActor(cwd, configDirName, roster) {
  const metrics = {};
  for (const member of roster.members ?? []) {
    if (!member.actorId) continue;
    const path = join(cwd, configDirName, "runtime", "runs", member.actorId, "events.jsonl");
    metrics[member.actorId] = summarizeWorkerEvents(readEvents(path));
  }
  return metrics;
}
