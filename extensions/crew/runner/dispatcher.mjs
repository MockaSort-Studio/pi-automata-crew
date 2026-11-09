import { createDependencyLedger } from "../crew/lib/dependency-ledger.mjs";
import { createAgentPool } from "./agent-pool.mjs";
import { createCiGate } from "./dispatcher-ci.mjs";
import {
  AWAITING_MAIN,
  MESSAGEABLE,
  carryEvidence,
  createMemberRecords,
  handoffRecord,
  holdRecord,
  recoveryPrompt,
  startupFailure,
} from "./member-lifecycle.mjs";

const CANCEL_MS = 5000;
// A cancel leaves these alone: they already ended.
const ENDS_CANCEL = new Set(["completed", "cancelled", "handed_off"]);

// Hands each member its assignment when its prerequisites are done, and reports what each run did.
// Ordering is the existing pure dependency ledger. Nothing is terminal until Main says so: a member that asks
// a question or fails is held (its dependents wait) and resumes when Main messages it. Main may also put it on
// hold (no turn), hand it off (VM released, dependents still held) or cancel it. See member-lifecycle.mjs.
//
// `createAgent(member)` supplies, for one member, { run, salvage?, verify?, dispose? }: the run is an AgentRun
// (prompt/abort/dispose), salvage is an optional host-side rescue of the agent's work, and verify is an optional
// check of what the member claims to have finished (a green CI on its pull request). A member whose check is red
// is resumed in the same session with what failed, until it is green or `maxCiRounds` attempts have not been
// enough; then it asks Main. The dispatcher knows nothing about VMs, Pi or GitHub.
export function createDispatcher({
  members,
  createAgent,
  onResult = () => {},
  onState = () => {},
  onIdle = () => {},
  maxParallel = 4,
  maxCiRounds = 5,
  scrub = (text) => text,
  // Main's hold and handoff decisions, as they are recorded: (handle, { type, ...record }).
  onDecision = () => {},
  now = () => new Date().toISOString(),
  // How long a cancel waits for a running turn to end before it ends the member itself.
  cancelMs = CANCEL_MS,
}) {
  const ledger = createDependencyLedger();
  for (const member of members) ledger.addNode(member.handle);
  for (const member of members)
    for (const dependency of member.dependsOn ?? []) ledger.addDependency(member.handle, dependency);

  const byHandle = new Map(members.map((member) => [member.handle, member]));
  const state = new Map(members.map((member) => [member.handle, "queued"]));
  const pool = createAgentPool();
  const records = createMemberRecords({ scrub, now });
  // One per turn: its job, and the controller whose abort cancels a wait for CI as well as a model call.
  const running = new Map();
  let disposed = false;

  const setState = (handle, next) => {
    // Once the member works again, its last CI snapshot describes an earlier turn until it is checked again.
    if (next === "running") records.stale(handle);
    if (state.get(handle) === next) return;
    state.set(handle, next);
    onState(handle, next);
  };
  // A turn's end, or a cancel's: the member's state and its ledger node always move together.
  const settle = (handle, status) => {
    if (status === "completed") ledger.complete(handle);
    else if (status === "cancelled") ledger.fail(handle);
    // needs_input and failed both wait for Main: the dependents stay held until this member completes.
    else ledger.block(handle);
    setState(handle, status);
    if (status === "cancelled") void pool.release(handle);
  };
  const ciGate = createCiGate({ setState, scrub, maxCiRounds, now, onCheck: records.checked, onStale: records.stale });

  async function turn(handle, text, stop) {
    setState(handle, "running");
    const cancelled = () => state.get(handle) === "cancelled";
    let result;
    let agent = pool.get(handle);
    let salvageAttempted = false;
    try {
      if (!agent) {
        // A member recovered after a handoff continues with the runner-recorded evidence of its earlier session.
        agent = carryEvidence(await createAgent(byHandle.get(handle)), records.evidence(handle));
        pool.set(handle, agent);
      }
      if (cancelled()) return void pool.release(handle);
      // Cancelled while its agent was created: no model turn starts, and there is no work to salvage.
      if (stop.signal.aborted) result = { status: "cancelled", finalText: "" };
      else {
        result = await agent.run.prompt(text, { signal: stop.signal });
        if (cancelled()) return;
        result = await ciGate.gate(handle, agent, result, stop.signal);
        // Leaves `result` unset only when the member was cancelled meanwhile; the cancel reported it.
        result = await ciGate.salvage(handle, agent, result, stop.signal, {
          stopped: cancelled,
          attempting: (attempted) => (salvageAttempted = attempted),
        });
      }
    } catch (error) {
      if (stop.signal.aborted) {
        result = { status: "cancelled", finalText: "" };
        if (cancelled()) return;
        try {
          const salvaged = salvageAttempted ? undefined : await agent?.salvage?.("cancelled");
          if (salvaged) result.salvage = salvaged;
        } catch {
          // Cancellation remains terminal even if salvage fails.
        }
      } else result = startupFailure(scrub, error?.message);
    }
    if (cancelled()) return;
    if (stop.signal.aborted) result = { ...result, status: "cancelled" };
    result = records.report(handle, result);
    // Every turn starts with the node running: pump() starts it, and a follow-up resumes or reopens it.
    settle(handle, result.status);
    onResult(handle, result);
  }

  const startable = (handle) => {
    if (state.get(handle) !== "queued" || running.has(handle)) return false;
    const status = ledger.status(handle);
    return status === "ready" || (status === "waiting" && !ledger.dependenciesOf(handle).length);
  };

  function pump() {
    if (disposed) return;
    for (const handle of ledger.nodes()) {
      if (running.size >= maxParallel) break;
      if (!startable(handle)) continue;
      ledger.start(handle);
      launch(handle, records.promptFor(byHandle.get(handle)));
    }
    if (!running.size) onIdle(snapshot());
  }

  function launch(handle, text) {
    const entry = { stop: new AbortController() };
    entry.job = turn(handle, text, entry.stop)
      .catch(() => undefined)
      .finally(() => {
        if (running.get(handle) === entry) running.delete(handle);
        pump();
      });
    running.set(handle, entry);
  }

  // A member that has not started because a prerequisite is held is "held", not merely queued.
  const shown = (handle) =>
    state.get(handle) === "queued" && ledger.status(handle) === "blocked" ? "held" : state.get(handle);
  const snapshot = () =>
    members.map(({ handle }) => records.status({ handle, state: shown(handle), ledger: ledger.status(handle) }));
  const idle = (handle, verb) => {
    if (!byHandle.has(handle)) throw new Error(`Unknown member: ${handle}`);
    if (disposed) throw new Error("The crew has been disposed");
    if (running.has(handle) || !AWAITING_MAIN.has(state.get(handle)))
      throw new Error(`${handle} is ${shown(handle)}; only a member waiting for Main can be ${verb}`);
  };

  return {
    start: pump,
    status: snapshot,
    // Main's answer, a retry, or a follow-up: the same conversation continues. Main's hold or handoff is shown
    // only while the member is in that state, so a resumed member needs nothing cleared.
    message(handle, text) {
      if (!byHandle.has(handle)) throw new Error(`Unknown member: ${handle}`);
      if (disposed) throw new Error("The crew has been disposed");
      const current = state.get(handle);
      if (!MESSAGEABLE.has(current))
        throw new Error(`${handle} is ${current}; it can be messaged once it has reported`);
      if (running.has(handle)) throw new Error(`${handle} is already working`);
      ciGate.answer(handle, text);
      // A handed-off member's VM is gone: it is recovered in a new session that is told what it recovers from.
      const prompt =
        current === "handed_off"
          ? recoveryPrompt(records.promptFor(byHandle.get(handle)), records.handoffOf(handle), text)
          : text;
      // A follow-up reopens a completed member: whatever it ends as must be what the ledger says. A held or
      // handed-off member's node stayed blocked, so resuming it never released its dependents in between.
      if (ledger.status(handle) === "blocked") ledger.start(handle);
      else if (ledger.status(handle) === "complete") ledger.reopen(handle);
      launch(handle, prompt);
    },
    // Main acknowledges a member that waits for it, without a turn: the blocker, who owns it and what resumes
    // it are recorded. Only a later message resumes the member; nothing here polls or expires.
    hold(handle, params = {}) {
      idle(handle, "put on hold");
      const hold = JSON.parse(scrub(JSON.stringify(holdRecord(params, now()))));
      records.hold(handle, hold);
      setState(handle, "on_hold");
      onDecision(handle, { type: "hold", ...hold });
      return hold;
    },
    // Main ends a member as partial or superseded work: its VM is released, its unmet criteria and saved work
    // are recorded, and its node stays blocked, so nothing that depends on it starts. Not an acceptance. Its
    // last CI snapshot is history from now on, in the status as in the record.
    async handoff(handle, params = {}) {
      idle(handle, "handed off");
      const handoff = JSON.parse(
        scrub(JSON.stringify(handoffRecord(params, records.lastWork(handle), records.ci(handle), now()))),
      );
      records.handoff(handle, handoff);
      records.stale(handle);
      setState(handle, "handed_off");
      onDecision(handle, { type: "handoff", ...handoff });
      await pool.release(handle);
      return handoff;
    },
    // Aborts what is running and ends members that have not started. The abort reaches the guest (Stage 1),
    // and salvage still runs for a member that had work in progress.
    async cancel(handle) {
      const targets = handle ? [handle] : [...byHandle.keys()];
      for (const target of targets) if (!byHandle.has(target)) throw new Error(`Unknown member: ${target}`);
      const jobs = targets.map(async (target) => {
        const entry = running.get(target);
        if (entry) {
          entry.stop.abort();
          const agent = pool.get(target);
          void Promise.resolve()
            .then(() => agent?.run.abort())
            .catch(() => {});
          let timer;
          await Promise.race([entry.job, new Promise((resolve) => (timer = setTimeout(resolve, cancelMs)))]);
          clearTimeout(timer);
          // The turn did not end in time: the member ends here, and its late outcome is ignored.
          if (running.get(target) === entry && !ENDS_CANCEL.has(state.get(target))) {
            const result = records.report(target, { status: "cancelled", finalText: "" });
            settle(target, "cancelled");
            onResult(target, result);
            running.delete(target);
            pump();
          }
        } else if (!ENDS_CANCEL.has(state.get(target))) {
          // Cancelled is failed in the ledger too, so nothing reads it as waiting for input or for a prerequisite.
          if (["waiting", "ready", "blocked"].includes(ledger.status(target))) ledger.cancel(target);
          setState(target, "cancelled");
          void pool.release(target);
        }
      });
      await Promise.all(jobs);
    },
    async dispose() {
      disposed = true;
      await this.cancel();
      await pool.disposeAll();
    },
  };
}
