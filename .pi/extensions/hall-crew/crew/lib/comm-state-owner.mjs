// Typed live state for one Comm server. Comm is deliberately not an input:
// workers update their own lifecycle through the separate lifecycle_update RPC.
import { createDependencyLedger } from "./dependency-ledger.mjs";

export function createCommStateOwner() {
  const runs = new Map();

  function notify(namespace) {
    const run = runs.get(namespace);
    if (!run) return;
    const update = run.ledger.nodes().map((handle) => ({ handle, status: run.ledger.status(handle) }));
    for (const listener of run.listeners) listener(update);
  }

  function registerPlan(namespace, members = []) {
    if (!namespace || runs.has(namespace)) return { registered: false };
    const ledger = createDependencyLedger();
    for (const member of members) ledger.addNode(member.handle);
    for (const member of members)
      for (const dependency of member.dependsOn || []) ledger.addDependency(member.handle, dependency);
    runs.set(namespace, { ledger, members, listeners: new Set() });
    return { registered: true };
  }

  function hasPlan(namespace) {
    return runs.has(namespace);
  }

  function snapshot(namespace) {
    const run = runs.get(namespace);
    if (!run) return undefined;
    const taskByHandle = new Map(run.members.map((member) => [member.handle, member.task ?? ""]));
    return {
      namespace,
      nodes: run.ledger.nodes().map((handle) => ({
        handle,
        status: run.ledger.status(handle),
        dependsOn: run.ledger.dependenciesOf(handle),
        task: taskByHandle.get(handle) ?? "",
      })),
    };
  }

  function update(namespace, actorId, state) {
    const run = runs.get(namespace);
    const prefix = `${namespace}-`;
    const handle = actorId?.startsWith(prefix) ? actorId.slice(prefix.length) : undefined;
    if (!run || !handle || !run.ledger.has(handle)) return { updated: false };
    try {
      if (state === "running") run.ledger.start(handle);
      else if (state === "waiting") run.ledger.wait(handle);
      else if (state === "complete") run.ledger.complete(handle);
      else if (state === "blocked") run.ledger.block(handle);
      else if (state === "failed") run.ledger.fail(handle);
      else return { updated: false };
    } catch {
      return { updated: false };
    }
    notify(namespace);
    return { updated: true };
  }

  function subscribe(namespace, listener) {
    const run = runs.get(namespace);
    if (!run) return () => {};
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  function release(namespace) {
    runs.delete(namespace);
  }

  return { registerPlan, hasPlan, snapshot, update, subscribe, release };
}
