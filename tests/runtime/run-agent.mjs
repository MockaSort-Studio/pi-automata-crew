import { createAgentRun } from "../../extensions/crew/runner/agent-run.mjs";

// One agent, one assignment, then it is disposed. A convenience for tests; production code holds the run.
export async function runAgent({ task, signal, ...options }) {
  const run = await createAgentRun(options);
  try {
    return await run.prompt(task, { signal });
  } finally {
    run.dispose();
  }
}
