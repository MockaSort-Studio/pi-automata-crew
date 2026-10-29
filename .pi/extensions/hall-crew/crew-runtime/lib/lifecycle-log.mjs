import { mkdir, appendFile, readFile, readdir } from "node:fs/promises";
import { mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Durable, append-only Lifecycle log: one JSONL file per run at
// .pi/runtime/lifecycle/<runId>.jsonl. This module owns only append/read/
// replay of that file -- no snapshots, no compaction, no query API.
export const lifecycleLogDir = (cwd) => join(cwd, ".pi", "runtime", "lifecycle");
export const lifecycleLogPath = (cwd, runId) => join(lifecycleLogDir(cwd), `${runId}.jsonl`);

async function readLines(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return text
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
}

// Serialize writers per log file: appends must never interleave, or a
// concurrent dedup check could race past a write still in flight.
const queues = new Map();
function serialize(path, run) {
  const prior = queues.get(path) ?? Promise.resolve();
  const next = prior.then(run, run);
  queues.set(
    path,
    next.catch(() => {}),
  );
  return next;
}

// Appends one worker state-change event before the caller updates its own
// in-memory state. A repeated eventId is a no-op: the original event is
// returned, nothing new is written, and the version counter does not move.
export async function appendLifecycleEvent(cwd, runId, { eventId, actor, from, to, reason, retryOf, pid }) {
  if (!eventId || !actor) throw new Error("appendLifecycleEvent requires eventId and actor");
  const path = lifecycleLogPath(cwd, runId);
  return serialize(path, async () => {
    const events = await readLines(path);
    const existing = events.find((event) => event.eventId === eventId);
    if (existing) return { event: existing, appended: false };
    const event = {
      version: events.length + 1,
      eventId,
      actor,
      from: from ?? null,
      to,
      reason: reason ?? null,
      ...(retryOf !== undefined ? { retryOf } : {}),
      ...(pid !== undefined ? { pid } : {}),
      at: new Date().toISOString(),
    };
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`);
    return { event, appended: true };
  });
}

export async function readLifecycleEvents(cwd, runId) {
  return readLines(lifecycleLogPath(cwd, runId));
}

function readLinesSync(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return text
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
}

// A synchronous twin of appendLifecycleEvent for the one call site
// (a child process "exit" event) that races other listeners on the same
// event: an async append there could let an observer see stale in-memory
// status before the durable write actually lands. Lifecycle event volume is
// low enough that blocking IO here is an acceptable, deterministic trade.
export function appendLifecycleEventSync(cwd, runId, { eventId, actor, from, to, reason, retryOf, pid }) {
  if (!eventId || !actor) throw new Error("appendLifecycleEventSync requires eventId and actor");
  const path = lifecycleLogPath(cwd, runId);
  const events = readLinesSync(path);
  const existing = events.find((event) => event.eventId === eventId);
  if (existing) return { event: existing, appended: false };
  const event = {
    version: events.length + 1,
    eventId,
    actor,
    from: from ?? null,
    to,
    reason: reason ?? null,
    ...(retryOf !== undefined ? { retryOf } : {}),
    ...(pid !== undefined ? { pid } : {}),
    at: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  return { event, appended: true };
}

export async function listLifecycleRunIds(cwd) {
  const names = await readdir(lifecycleLogDir(cwd)).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return names.filter((name) => name.endsWith(".jsonl")).map((name) => name.slice(0, -".jsonl".length));
}

// Rebuilds each attempt's last known durable status from the ordered log.
// An attempt is keyed by actor id; a retry is a different actor id linked
// by retryOf, so replay never folds a retry's events into the attempt it
// retried.
// The run a Lifecycle event belongs to: config.namespace is "crew-<runId>"
// when a worker launches under a Crew run; fall back to a single shared log
// for ad hoc spawns that carry no namespace (e.g. direct controller tests).
export const runIdForConfig = (config) => (config?.namespace ? config.namespace.replace(/^crew-/, "") : "default");

// Durable statuses that never need owner-death recovery: the attempt already
// reached a terminal fact or was already recovered once.
const RECOVERED_STATUSES = new Set(["completed", "failed", "removed", "owner_lost"]);
const isProcessAlive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

// Every non-terminal attempt across every run whose process is confirmed
// gone: the owner_lost fact Lifecycle startup recovery must record.
export async function findOwnerLostAttempts(cwd) {
  const lost = [];
  for (const runId of await listLifecycleRunIds(cwd)) {
    const attempts = replayLifecycleState(await readLifecycleEvents(cwd, runId));
    for (const attempt of attempts.values()) {
      if (RECOVERED_STATUSES.has(attempt.status)) continue;
      if (isProcessAlive(attempt.pid)) continue;
      lost.push({ runId, actor: attempt.actor, from: attempt.status });
    }
  }
  return lost;
}

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
