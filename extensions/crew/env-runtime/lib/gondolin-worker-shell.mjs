import { randomUUID } from "node:crypto";
import { toGuestPath } from "./gondolin-worker-paths.mjs";

// Routed bash with the same semantics as Pi's local bash tool (docs: examples/extensions/gondolin and
// dist/core/tools/bash.js): the command runs in its own process group, cancelling kills that whole group,
// and the call returns when the shell exits, not when a background descendant closes inherited output.
// Gondolin alone provides neither: its exec abort only rejects the host-side session, and the guest
// reports exit only after every inherited stdout/stderr descriptor has closed.
const EXEC_DIR = "/tmp/.crew-exec";
const SHELL_GRACE_SECONDS = "0.3";
const KILL_GRACE_TICKS = 20;
const ABORT_SETTLE_MS = 5_000;

// $1 = id, $2 = command. Output is merged (as Pi's tool merges it) through a FIFO read by a reader that
// holds the exec's real stdout; the command and its descendants only hold the FIFO, so closing the reader
// shortly after the shell exits releases the exec even if a background child lives on.
export const EXEC_WRAPPER = `
id=$1; cmd=$2; d=${EXEC_DIR}; f=$d/$id.fifo
mkdir -p "$d" && mkfifo "$f" || exit 126
cat "$f" &
reader=$!
setsid /bin/sh -lc "$cmd" >"$f" 2>&1 </dev/null &
child=$!
echo "$child" >"$d/$id.pid"
wait "$child"; rc=$?
( sleep ${SHELL_GRACE_SECONDS}; kill "$reader" ) >/dev/null 2>&1 &
sleeper=$!
wait "$reader" 2>/dev/null
kill "$sleeper" 2>/dev/null
rm -f "$f" "$d/$id.pid"
exit $rc
`;

// $1 = id. Waits briefly for the pid file (abort can race the start), TERMs the group, then KILLs it.
export const KILL_SCRIPT = `
p=${EXEC_DIR}/$1.pid; i=0
while [ ! -s "$p" ] && [ $i -lt 20 ]; do sleep 0.05; i=$((i+1)); done
[ -s "$p" ] || exit 0
g=$(cat "$p"); kill -TERM -"$g" 2>/dev/null
i=0
while kill -0 -"$g" 2>/dev/null && [ $i -lt ${KILL_GRACE_TICKS} ]; do sleep 0.1; i=$((i+1)); done
kill -KILL -"$g" 2>/dev/null
exit 0
`;

export function bashOperations(vm, cwd, { abortSettleMs = ABORT_SETTLE_MS } = {}) {
  return {
    async exec(command, commandCwd, { onData, signal, timeout }) {
      if (signal?.aborted) throw new Error("aborted");
      const id = randomUUID().replaceAll("-", "");
      // The host session is deliberately not given the abort signal: rejecting it first would
      // detach from a command that is still running.
      const process = vm.exec(["/bin/sh", "-c", EXEC_WRAPPER, "crew-exec", id, command], {
        cwd: toGuestPath(cwd, commandCwd),
        stderr: "pipe",
        stdout: "pipe",
      });
      let reason;
      let stop;
      const stopped = new Promise((resolve) => (stop = resolve));
      const cancel = (why) => {
        if (reason) return;
        reason = why;
        // Settle even if the guest cannot be reached, so a dead VM never wedges the tool call.
        vm.exec(["/bin/sh", "-c", KILL_SCRIPT, "crew-kill", id])
          .catch(() => undefined)
          .then(() => setTimeout(stop, abortSettleMs).unref?.());
      };
      const onAbort = () => cancel("aborted");
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = timeout && timeout > 0 ? setTimeout(() => cancel(`timeout:${timeout}`), timeout * 1000) : undefined;
      const run = (async () => {
        for await (const chunk of process.output()) onData(chunk.data);
        return (await process).exitCode;
      })();
      try {
        const exitCode = await Promise.race([run, stopped.then(() => undefined)]);
        if (reason) throw new Error(reason);
        return { exitCode };
      } catch (error) {
        if (reason) throw new Error(reason);
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        run.catch(() => undefined);
      }
    },
  };
}
