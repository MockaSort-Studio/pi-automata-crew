// Workers announce readiness once their Comm socket is up; Main waits for a set of them.
export class ReadyBarrier {
  #ready = new Set();
  #waiters = new Set();

  mark(actorId) {
    this.#ready.add(actorId);
    for (const waiter of this.#waiters) waiter();
  }

  clear(actorId) {
    this.#ready.delete(actorId);
  }

  async wait(actorIds, timeoutMs = 30_000) {
    const ready = () => actorIds.every((id) => this.#ready.has(id));
    if (ready()) return { ready: actorIds };
    await new Promise((resolve, reject) => {
      const check = () => ready() && finish(resolve);
      const timer = setTimeout(() => finish(() => reject(new Error("Worker readiness timed out"))), timeoutMs);
      const finish = (done) => {
        clearTimeout(timer);
        this.#waiters.delete(check);
        done();
      };
      this.#waiters.add(check);
      check();
    });
    return { ready: actorIds };
  }
}
