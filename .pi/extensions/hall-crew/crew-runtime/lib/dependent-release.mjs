// Releases each dependent's task exactly once, when the typed ledger marks it
// `ready` (every prerequisite complete). Failure and block propagation stay with
// the ledger, which moves a failed prerequisite's dependents to `blocked` itself,
// so this only ever acts on `ready`.
export function createDependentRelease({ members, released = [], send, onError = () => {} }) {
  const done = new Set(released);
  const pending = new Map(members.filter((member) => member.dependsOn?.length).map((member) => [member.handle, member]));

  async function observe(nodes) {
    const ready = nodes.filter((node) => node.status === "ready" && pending.has(node.handle) && !done.has(node.handle));
    // Mark before sending, synchronously, so concurrent observations cannot double-send.
    for (const node of ready) done.add(node.handle);
    for (const node of ready) {
      try {
        await send(pending.get(node.handle));
      } catch (error) {
        onError(pending.get(node.handle), error);
      }
    }
    return ready.map((node) => node.handle);
  }

  return { observe, released: () => [...done], held: () => [...pending.keys()].filter((handle) => !done.has(handle)) };
}
