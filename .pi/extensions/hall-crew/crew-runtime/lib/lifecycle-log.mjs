import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

// Durable, append-only Lifecycle log: one JSONL file per run at .pi/runtime/lifecycle/<runId>.jsonl.
// The Lifecycle server is the only writer, appends are small and rare, so everything here is
// synchronous: an append is on disk before the caller changes any in-memory state.
const logDir = (cwd) => join(cwd, ".pi", "runtime", "lifecycle");
export const lifecycleLogPath = (cwd, runId) => join(logDir(cwd), `${runId}.jsonl`);

const parseLines = (text) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

function readFileOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

export const readLifecycleEvents = (cwd, runId) => parseLines(readFileOrEmpty(lifecycleLogPath(cwd, runId)));

// Duplicate detection must not re-read the whole log on every append. The index is rebuilt only
// when the file's size differs from what this process last wrote (another writer touched it).
const indexes = new Map();
function indexFor(path) {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const cached = indexes.get(path);
  if (cached?.size === size) return cached;
  const events = parseLines(readFileOrEmpty(path));
  const fresh = { size, byId: new Map(events.map((event) => [event.eventId, event])) };
  indexes.set(path, fresh);
  return fresh;
}

// A repeated eventId is a no-op: the original event is returned and nothing is written.
export function appendLifecycleEvent(cwd, runId, { eventId, actor, from, to, reason, retryOf, pid }) {
  if (!eventId || !actor) throw new Error("appendLifecycleEvent requires eventId and actor");
  const path = lifecycleLogPath(cwd, runId);
  const index = indexFor(path);
  const existing = index.byId.get(eventId);
  if (existing) return { event: existing, appended: false };
  const event = {
    version: index.byId.size + 1,
    eventId,
    actor,
    from: from ?? null,
    to,
    reason: reason ?? null,
    ...(retryOf !== undefined ? { retryOf } : {}),
    ...(pid !== undefined ? { pid } : {}),
    at: new Date().toISOString(),
  };
  const line = `${JSON.stringify(event)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line);
  index.size += Buffer.byteLength(line);
  index.byId.set(eventId, event);
  return { event, appended: true };
}

// The run a Lifecycle event belongs to: "crew-<runId>" namespaces map to their run. A spawn with no
// namespace gets a log of its own, so unrelated ad hoc spawns never share a run.
export const runIdForConfig = (config, actorId) =>
  config?.namespace ? config.namespace.replace(/^crew-/, "") : `adhoc-${actorId}`;

// Rebuilds each attempt's last known durable status from the ordered log. An attempt is keyed by
// actor id; a retry is a different actor id linked by retryOf, so replay never folds a retry's
// events into the attempt it retried.
export function replayLifecycleState(events) {
  const attempts = new Map();
  for (const event of events) {
    const attempt = attempts.get(event.actor) ?? { actor: event.actor, history: [] };
    attempt.history.push(event);
    attempt.status = event.to;
    if (event.retryOf !== undefined) attempt.retryOf = event.retryOf;
    if (event.pid !== undefined) attempt.pid = event.pid;
    attempts.set(event.actor, attempt);
  }
  return attempts;
}

// Statuses that never need owner-death recovery: already terminal or already recovered once.
const RECOVERED_STATUSES = new Set(["completed", "failed", "removed", "owner_lost"]);

// A pid proves nothing on its own, because the OS reuses them. The live process must also be this
// actor's worker: its command line carries the actor's run directory. If `ps` is unavailable the
// signal-0 check stands alone.
function isWorkerAlive(pid, actor) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") return false;
  }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes(actor);
  } catch (error) {
    return error.code === "ENOENT";
  }
}

// Every non-terminal attempt, across all runs, whose worker is gone: the owner_lost facts that
// Lifecycle startup recovery must record.
export function findOwnerLostAttempts(cwd) {
  const lost = [];
  let names = [];
  try {
    names = readdirSync(logDir(cwd));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const name of names.filter((item) => item.endsWith(".jsonl"))) {
    const runId = name.slice(0, -".jsonl".length);
    for (const attempt of replayLifecycleState(readLifecycleEvents(cwd, runId)).values()) {
      if (RECOVERED_STATUSES.has(attempt.status) || isWorkerAlive(attempt.pid, attempt.actor)) continue;
      lost.push({ runId, actor: attempt.actor, from: attempt.status });
    }
  }
  return lost;
}
