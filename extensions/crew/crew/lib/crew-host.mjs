import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createCrewTerminalNotifier } from "../../crew-runtime/lib/crew-terminal-notifier.mjs";
import { createHostClient } from "../../runner/host-client.mjs";
import { crewReportMessage, hostExitMessage } from "./crew-reports.mjs";

// Main's one connection to the crew host. It lives on globalThis because Pi re-evaluates extensions on
// /reload: the host process, its crews and this bookkeeping must survive that, while delivery always goes
// through the current `pi`.
const holder = (globalThis.__piCrewHost ??= {
  client: undefined,
  pi: undefined,
  notifier: undefined,
  runs: new Map(),
  stopping: false,
});

export const bindCrewHost = (pi) => {
  holder.pi = pi;
};
const deliver = (message, options = { triggerTurn: true, deliverAs: "steer" }) =>
  holder.pi?.sendMessage(message, options);

// The append-only record of a run: every result and state change the host reported.
function record(runId, event) {
  const dir = holder.runs.get(runId);
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  } catch {}
}

function onEvent(event) {
  record(event.runId, event);
  if (event.event === "result") deliver(crewReportMessage(event));
  if (event.event === "idle")
    holder.notifier.observe({
      namespace: event.runId,
      nodes: event.members.map((m) => ({ handle: m.handle, status: m.ledger })),
    });
}

export function crewHost({ cwd, configDir, createClient = createHostClient }) {
  holder.notifier ??= createCrewTerminalNotifier((message, options) => deliver(message, options));
  return {
    client() {
      holder.client ??= createClient({
        cwd,
        logFile: join(cwd, configDir, "runtime", "crew-host.log"),
        onEvent,
        onExit: (exit) => {
          holder.client = undefined;
          holder.runs.clear();
          if (!holder.stopping) deliver(hostExitMessage(exit));
          holder.stopping = false;
        },
      });
      return holder.client;
    },
    track: (runId, dir) => holder.runs.set(runId, dir),
    untrack: (runId) => holder.runs.delete(runId),
    runs: () => [...holder.runs.keys()],
    async stop() {
      if (!holder.client) return;
      holder.stopping = true;
      await holder.client.stop();
    },
  };
}
