import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolveBundles } from "./tool-bundles.mjs";
import { connectLifecycle } from "./lifecycle-client.mjs";
import { reapOrphans, recordOwner, removeOwner } from "./lifecycle-registry.mjs";
import { preserveEvidence, waitReadyOrExit } from "./crew-launch.mjs";
import { MainComm } from "./main-comm.mjs";
import { dispatchRoots } from "./root-dispatch.mjs";
import { startServer, stopProcess } from "./server-process.mjs";

const defaultTools = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export class Runtime extends MainComm {
  #dispatches = new Map();
  #lifecycle;
  #lifecycleProcess;
  #releaseUnsubscribers = new Map();

  constructor(cwd) {
    super();
    this.cwd = cwd;
  }

  async #ensureLifecycle() {
    if (this.#lifecycle) return;
    // Best-effort: reap Lifecycle servers left behind by a dead Main
    // session before starting a new one. Never blocks startup on failure.
    await reapOrphans(this.cwd).catch(() => {});
    const authToken = randomUUID();
    const config = JSON.stringify({
      cwd: this.cwd,
      workerModule: join(import.meta.dirname, "worker.mjs"),
      authToken,
      hostPid: process.pid,
    });
    const { child, info } = await startServer(join(import.meta.dirname, "lifecycle-server.mjs"), JSON.parse(config));
    this.#lifecycleProcess = child;
    const { port } = info;
    await recordOwner(this.cwd, { pid: child.pid, hostPid: process.pid, port }).catch(() => {});
    this.#lifecycle = await connectLifecycle(`ws://127.0.0.1:${port}`, { authToken });
  }

  // `plan` ({ namespace, members: [{handle, dependsOn, task}] }) is
  // optional and, when given, registered once with the Comm server so it
  // becomes the live owner of that run's dependency-ledger status (see
  // comm-state-owner.mjs) -- callers never need to reconstruct that DAG
  // themselves from raw envelopes.
  // With a Pi session attached, each Main delivery starts a turn instead of
  // waiting to be polled; it stays pending for reply/acknowledge either way.
  async dispatchRoots(runId, idempotencyKey) {
    if (!idempotencyKey || typeof idempotencyKey !== "string") throw new Error("Dispatch idempotencyKey is required");
    const namespace = `crew-${runId}`;
    const prior = this.#dispatches.get(namespace);
    if (prior?.key === idempotencyKey) return prior.result;
    if (prior) throw new Error("Initial Crew dispatch already exists");
    const members = this.plans.get(namespace);
    if (!members) throw new Error("Unknown Crew dispatch plan");
    const result = await dispatchRoots({
      runId,
      members,
      send: (handle, payload) => this.sendMember(runId, handle, payload),
      releaseDependents: (release) => this.#releaseDependents(namespace, release),
    });
    this.#dispatches.set(namespace, { key: idempotencyKey, result });
    return result;
  }

  // After the roots are dispatched, each dependent receives its task the moment the
  // ledger marks it ready; the snapshot covers a prerequisite that already finished.
  async #releaseDependents(namespace, release) {
    const unsubscribe = this.comm.observeState(namespace, (nodes) => release.observe(nodes).catch(() => {}));
    this.#releaseUnsubscribers.set(namespace, unsubscribe);
    const snapshot = await this.comm.getStateSnapshot(namespace);
    if (snapshot) await release.observe(snapshot.nodes);
  }

  async broadcast(namespace, payload) {
    if (!this.comm) throw new Error("Communication controller is not running");
    return this.comm.broadcast({ namespace, payload });
  }

  async launchCrew(agents, adapters = [], plan, { readyTimeoutMs = 30_000 } = {}) {
    const actorIds = agents.map((agent) => agent.actorId).filter(Boolean);
    if (new Set(actorIds).size !== actorIds.length) throw new Error("Crew agent actor IDs must be unique.");
    const members = Object.fromEntries(agents.map((agent) => [agent.name, agent.actorId]));
    const comm = await this.startComm(
      agents.map(({ actorId, role }) => ({ actorId, role })),
      adapters.map((adapter) => ({
        ...adapter,
        recipients: members,
        lead: agents.find((agent) => agent.role === "lead")?.actorId,
      })),
      plan,
    );
    const launched = [];
    try {
      for (const agent of agents) launched.push(await this.spawn(agent));
      if (plan?.namespace && agents.every((agent) => agent.resident))
        await waitReadyOrExit({ comm: this.comm, lifecycle: this.#lifecycle, namespace: plan.namespace, launched, actorIds, timeoutMs: readyTimeoutMs });
      return { comm, agents: launched };
    } catch (error) {
      await preserveEvidence(this.cwd, launched);
      await Promise.allSettled(launched.map((agent) => this.remove(agent.id)));
      // A failed launch owns its servers unless another Crew still uses them.
      if (!(await this.list().catch(() => [])).length) await this.stop();
      throw error;
    }
  }

  async spawn({ actorId, tools = defaultTools, extensionPaths = [], bundles = [], comm, thinking = "off", resident = false, initialTurn = "startup", ...agent }) {
    await this.#ensureLifecycle();
    const bundle = resolveBundles(this.cwd, bundles);
    const id = actorId ?? randomUUID();
    if (this.comm) await this.comm.registerActor(id);
    // The worker claims its own mailbox after its authenticated Comm socket connects. Main
    // must not claim a worker mailbox on its behalf.
    return this.#lifecycle.spawn({
      ...agent,
      actorId: id,
      thinking,
      resident,
      initialTurn,
      tools: [...new Set([...tools, ...bundle.tools])],
      extensionPaths: [...new Set([...extensionPaths, ...bundle.extensionPaths])],
      comm: comm ?? (this.commUrl ? { url: this.commUrl, actorId: id, namespace: agent.namespace, authToken: this.commAuthToken } : undefined),
    });
  }

  async list() {
    await this.#ensureLifecycle();
    return this.#lifecycle.list();
  }

  async inspect(id) {
    await this.#ensureLifecycle();
    const agent = await this.#lifecycle.inspect(id);
    if (!agent?.found || !agent.namespace || !this.comm) return agent;
    const snapshot = await this.comm.getStateSnapshot(agent.namespace).catch(() => undefined);
    const lifecycleStatus = snapshot?.nodes?.find((node) => node.handle === agent.name)?.status;
    if (!lifecycleStatus) return agent;
    return { ...agent, processStatus: agent.status, lifecycleStatus, status: lifecycleStatus };
  }

  async remove(id) {
    await this.#ensureLifecycle();
    return this.#lifecycle.remove(id);
  }

  async stop() {
    const agents = this.#lifecycle ? await this.list() : [];
    const removals = await Promise.allSettled(agents.map((agent) => this.remove(agent.id)));
    this.#lifecycle?.close();
    const ownerPid = this.#lifecycleProcess?.pid;
    await Promise.all([stopProcess(this.#lifecycleProcess), stopProcess(this.commProcess)]);
    if (ownerPid) await removeOwner(this.cwd, ownerPid).catch(() => {});
    this.#lifecycle = undefined;
    this.#lifecycleProcess = undefined;
    this.closeComm();
    for (const unsubscribe of this.#releaseUnsubscribers.values()) unsubscribe();
    this.#releaseUnsubscribers.clear();
    return {
      removals: removals.map((result) =>
        result.status === "fulfilled" ? result.value : { removed: false, error: String(result.reason) },
      ),
    };
  }
}
