// Which actors belong to which Crew namespace, and who may route to or observe whom.
export class CommAccess {
  #namespaces = new Map();

  namespaceOf = (actorId) => this.#namespaces.get(actorId);
  assign = (actorId, namespace) => this.#namespaces.set(actorId, namespace);

  assertNamespace(actorId, namespace) {
    if (actorId === "main") return;
    if (!actorId || !namespace || this.#namespaces.get(actorId) !== namespace)
      throw new Error("Cross-Crew namespace access is forbidden");
  }

  assertPeer(from, to) {
    if (from === "main" || to === "main" || from === "human:github-discussion") return;
    const fromNamespace = this.#namespaces.get(from);
    const toNamespace = this.#namespaces.get(to);
    if (fromNamespace && toNamespace && fromNamespace !== toNamespace) throw new Error("Cross-Crew routing is forbidden");
  }

  canObserve(actorId, envelope) {
    if (actorId === "main") return true;
    const namespace = this.#namespaces.get(actorId);
    if (namespace) return [envelope.from, envelope.to].some((id) => this.#namespaces.get(id) === namespace);
    return envelope.from === actorId || envelope.to === actorId;
  }
}
