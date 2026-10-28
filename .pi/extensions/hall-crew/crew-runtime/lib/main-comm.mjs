import { join } from "node:path";
import { connectComm } from "./comm-client.mjs";
import { createCrewTerminalNotifier } from "./crew-terminal-notifier.mjs";
import { MainInbox } from "./main-inbox.mjs";
import { startServer } from "./server-process.mjs";

// Main's side of Crew communication: the Comm server it owns, its messages to members, its own
// mailbox, and the terminal-state notices. `Runtime` extends this with workers and launch.
export class MainComm {
  comm;
  commUrl;
  commProcess;
  commAuthToken;
  plans = new Map();
  main = new MainInbox();
  terminalNotifier;
  stateUnsubscribers = new Map();

  attachMainDelivery(sendMessage) {
    return this.main.attach(sendMessage);
  }

  attachTerminalNotifier(sendMessage) {
    this.terminalNotifier = createCrewTerminalNotifier(sendMessage);
    return () => {
      this.terminalNotifier = undefined;
      for (const unsubscribe of this.stateUnsubscribers.values()) unsubscribe();
      this.stateUnsubscribers.clear();
    };
  }

  async observeTerminalState(namespace) {
    if (!this.terminalNotifier || !this.comm || this.stateUnsubscribers.has(namespace)) return;
    const unsubscribe = this.comm.observeState(namespace, (nodes, observedNamespace) =>
      this.terminalNotifier?.observe({ namespace: observedNamespace, nodes }),
    );
    this.stateUnsubscribers.set(namespace, unsubscribe);
    const initial = await this.comm.getStateSnapshot(namespace);
    if (initial) this.terminalNotifier.observe(initial);
  }

  async startComm(actors = [], adapters = [], plan) {
    if (!this.comm) {
      const { child, info } = await startServer(join(import.meta.dirname, "comm-server.mjs"), { adapters, hostPid: process.pid });
      this.commProcess = child;
      const { port, authToken } = info;
      this.commAuthToken = authToken;
      this.commUrl = `ws://127.0.0.1:${port}`;
      this.comm = await connectComm({ url: this.commUrl, actorId: "main", authToken });
      this.comm.onDelivery((message) => this.main.deliver(message));
    }
    await Promise.all(
      actors.map((actor) =>
        typeof actor === "string" ? this.comm.registerActor(actor) : this.comm.registerActor(actor.actorId, actor.role),
      ),
    );
    if (plan?.namespace) {
      this.plans.set(plan.namespace, plan.members ?? []);
      await this.comm.registerPlan(plan.namespace, plan.members ?? []);
      await this.observeTerminalState(plan.namespace);
    }
    return { url: this.commUrl, authToken: this.commAuthToken };
  }

  memberId(runId, handle) {
    if (!/^[0-9a-f-]{36}$/i.test(runId) || !/^[a-z]+-[a-z0-9-]+-\d{2}$/i.test(handle))
      throw new Error("runId and member handle are required");
    return `crew-${runId}-${handle}`;
  }

  async send(to, payload) {
    if (!this.comm) throw new Error("Communication controller is not running");
    return this.comm.emit({ to, payload });
  }

  async sendMember(runId, to, payload) {
    return this.send(this.memberId(runId, to), payload);
  }

  async request(runId, to, payload) {
    if (!this.comm) throw new Error("Communication controller is not running");
    return this.comm.emit({ to: this.memberId(runId, to), payload, replyRequired: true });
  }

  async broadcastRun(runId, payload) {
    return this.broadcast(`crew-${runId}`, payload);
  }

  async broadcast(namespace, payload) {
    if (!this.comm) throw new Error("Communication controller is not running");
    return this.comm.broadcast({ namespace, payload });
  }

  async receive(actorId = "main") {
    if (!this.comm) throw new Error("Communication controller is not running");
    if (actorId === "main") {
      const queued = this.main.next();
      if (queued) return queued;
    }
    return (await this.comm.claim(actorId)) ?? null;
  }

  async acknowledgeMain(messageId) {
    return this.main.acknowledge(messageId);
  }

  async replyFromMain(messageId, payload) {
    return this.main.reply(messageId, payload, (envelope) => this.comm.emit(envelope));
  }

  async inspectComm() {
    if (!this.comm) throw new Error("Communication controller is not running");
    return this.comm.inspect();
  }

  // Internal-facing, like CommController.observeRaw(): the full unfiltered
  // envelope stream over Main's own WS connection, for in-process observers
  // (e.g. the live dependency ledger behind the Crew dashboard) that must
  // stay current with kickoff/report activity across the whole Crew, not
  // only messages addressed to "main". A no-op unsubscribe when Comm is not
  // running yet (nothing to observe before startComm()).
  observeRawComm(handler) {
    if (!this.comm) return () => {};
    return this.comm.observeRaw(handler);
  }

  closeComm() {
    this.comm?.close();
    this.comm = undefined;
    this.commProcess = undefined;
    this.commUrl = undefined;
    this.commAuthToken = undefined;
    this.main.reset();
    for (const unsubscribe of this.stateUnsubscribers.values()) unsubscribe();
    this.stateUnsubscribers.clear();
  }
}
