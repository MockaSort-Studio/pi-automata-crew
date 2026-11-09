// The crew's agents, one per member, and their disposal. Each agent's disposal is isolated: one that throws or
// hangs never stops another, and waiting for one is bounded, so an agent that never finishes disposing cannot
// hold Main. Disposals that have not succeeded yet are kept, so the crew's final cleanup can await or retry them.
export function createAgentPool({ disposeMs = 5000 } = {}) {
  const agents = new Map();
  const undisposed = new Map();

  const bounded = (work) => {
    let timer;
    return Promise.race([
      Promise.resolve()
        .then(work)
        .catch(() => {}),
      new Promise((resolve) => (timer = setTimeout(resolve, disposeMs))),
    ]).finally(() => clearTimeout(timer));
  };
  const disposeAgent = (agent) => {
    const entry = { failed: false };
    entry.attempt = Promise.resolve()
      .then(() => agent.dispose?.())
      .then(
        () => undisposed.get(agent) === entry && undisposed.delete(agent),
        () => (entry.failed = true),
      );
    undisposed.set(agent, entry);
    return entry.attempt;
  };

  return {
    get: (handle) => agents.get(handle),
    set: (handle, agent) => agents.set(handle, agent),
    // Frees a member's VM. The agent leaves the crew at once, so a recovery never reuses it.
    release(handle) {
      const agent = agents.get(handle);
      agents.delete(handle);
      return agent ? bounded(() => disposeAgent(agent)) : Promise.resolve();
    },
    // Every agent still held, and every earlier disposal that failed (retried) or is still running (awaited).
    // Earlier disposals first, so an agent disposed below is not awaited twice.
    async disposeAll() {
      const cleanup = [...undisposed].map(([agent, entry]) => (entry.failed ? disposeAgent(agent) : entry.attempt));
      cleanup.push(...[...agents.values()].map(disposeAgent));
      agents.clear();
      await bounded(() => Promise.all(cleanup));
    },
  };
}
