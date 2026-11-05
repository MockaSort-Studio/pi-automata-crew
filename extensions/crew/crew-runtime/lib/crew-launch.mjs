import { cp } from "node:fs/promises";
import { join } from "node:path";

// A worker that exits before it is ready can never become ready, so fail the launch as soon as
// that is seen instead of waiting out the readiness timeout.
export async function waitReadyOrExit({ comm, lifecycle, namespace, launched, actorIds, timeoutMs }) {
  const ids = new Set(launched.map((agent) => agent.id));
  let watching = true;
  const exited = (async () => {
    while (watching) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const gone = (await lifecycle.list()).find((agent) => ids.has(agent.id) && agent.status !== "running");
      if (gone) throw new Error(`Worker ${gone.name} exited before it was ready (${gone.status})`);
    }
  })();
  const ready = comm.waitReady(namespace, actorIds, timeoutMs);
  try {
    return await Promise.race([ready, exited]);
  } finally {
    watching = false;
    exited.catch(() => {});
    ready.catch(() => {});
  }
}

// Worker evidence is kept outside the run directory before a failed launch is rolled back.
export const preserveEvidence = (cwd, launched) =>
  Promise.allSettled(
    launched.map((agent) =>
      cp(join(cwd, ".pi", "runtime", "runs", agent.id), join(cwd, ".pi", "runtime", "archive", agent.id), {
        recursive: true,
        force: true,
      }),
    ),
  );
