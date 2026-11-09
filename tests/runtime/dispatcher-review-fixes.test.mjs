import { strict as assert } from "node:assert";
import test from "node:test";
import { createDispatcher } from "../../extensions/crew/runner/dispatcher.mjs";

// Regressions from the post-iteration lifecycle review: each test fails on the code it was found in.
const A = "developer-alpha-00";
const B = "developer-bravo-00";
const C = "developer-charlie-00";
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const result = (status, extra = {}) => ({ status, finalText: `${status} text`, evidence: {}, ...extra });
const withPr = (status, commit = H1) =>
  result(status, { evidence: { pullRequest: "https://github.com/o/r/pull/7", pushed: { commit } } });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};
// Resolves only when its signal aborts: a prompt that ignores run.abort() and listens to its signal alone.
const untilAborted = (signal) =>
  new Promise((resolve) => signal?.addEventListener("abort", () => resolve(result("cancelled")), { once: true }));

// Each prompt takes the next step of its member's script: an outcome, or a function of (text, options).
function crew({ members, script = {}, agentOf = () => ({}), ...options }) {
  const prompts = {};
  const results = [];
  const disposed = [];
  const d = createDispatcher({
    members,
    onResult: (handle, r) => results.push([handle, r.status]),
    createAgent: async ({ handle }) => {
      prompts[handle] ??= [];
      const queue = script[handle] ?? [];
      return {
        run: {
          prompt: async (text, opts) => {
            prompts[handle].push(text);
            const step = queue.shift();
            return typeof step === "function" ? step(text, opts) : (step ?? result("completed"));
          },
          abort: async () => {},
        },
        dispose: async () => disposed.push(handle),
        ...agentOf(handle),
      };
    },
    ...options,
  });
  const of = (handle) => d.status().find((m) => m.handle === handle);
  return { d, prompts, results, disposed, of };
}

// 1 BLOCKING: reopening a completed member while its dependent runs must not strand the dependent.
for (const [name, ending] of [
  ["fails", (c) => c.d.message(A, "again")],
  ["asks a question", (c) => c.d.message(A, "again")],
  ["is cancelled", (c) => (c.d.message(A, "again"), settle().then(() => c.d.cancel(A)))],
]) {
  test(`A completes, B starts, A is reopened and ${name}: B still reports and the crew can be cancelled`, async () => {
    const gateB = deferred();
    const second = {
      fails: result("failed", { failure: { category: "empty_turn" } }),
      "asks a question": result("needs_input"),
      "is cancelled": (_text, opts) => untilAborted(opts?.signal),
    }[name];
    const c = crew({
      members: [
        { handle: A, task: "do A" },
        { handle: B, task: "do B", dependsOn: [A] },
      ],
      script: { [A]: [result("completed"), second], [B]: [() => gateB.promise.then(() => result("completed"))] },
    });
    c.d.start();
    await settle();
    assert.deepEqual([c.of(B).state, c.of(B).ledger], ["running", "running"]);
    await ending(c);
    await settle();
    assert.equal(c.of(B).ledger, "running", "B ran on A's earlier result and is left alone");
    gateB.resolve();
    await settle();
    assert.deepEqual([c.of(B).state, c.of(B).ledger], ["completed", "complete"], "B ends as itself");
    assert.ok(
      c.results.some(([handle, status]) => handle === B && status === "completed"),
      "and Main hears B's report",
    );
    await c.d.cancel();
    assert.equal(c.of(B).state, "completed", "a whole-crew cancel leaves what completed alone");
    assert.notEqual(c.of(A).ledger, "running");
  });
}

// 2 MAJOR: a cancel during agent creation starts no model turn and is prompt.
test("cancelling while the agent is being created starts no turn, releases the agent, and returns at once", async () => {
  const created = deferred();
  const prompts = [];
  const disposed = [];
  const results = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    onResult: (handle, r) => results.push([handle, r.status]),
    createAgent: async () => {
      await created.promise;
      return {
        run: { prompt: (text, opts) => (prompts.push(text), untilAborted(opts?.signal)), abort: async () => {} },
        dispose: async () => disposed.push(A),
      };
    },
  });
  d.start();
  await settle();
  const started = Date.now();
  const cancelling = d.cancel(A);
  created.resolve();
  await cancelling;
  assert.ok(Date.now() - started < 1000, `cancel took ${Date.now() - started}ms`);
  await settle();
  assert.deepEqual(prompts, [], "no PROMPT after cancel");
  assert.deepEqual(results, [[A, "cancelled"]]);
  assert.equal(d.status()[0].ledger, "failed");
  assert.deepEqual(disposed, [A], "the late agent is released");
});

test("the cancel reaches a prompt through its signal, for the first turn and for a CI follow-up", async () => {
  for (const followUp of [false, true]) {
    const signals = [];
    const prompt = (_text, opts) => (signals.push(opts?.signal), untilAborted(opts?.signal));
    const c = crew({
      members: [{ handle: A, task: "a" }],
      script: { [A]: followUp ? [withPr("completed"), prompt] : [prompt] },
      agentOf: () =>
        followUp
          ? { verify: async () => ({ state: "failure", pullNumber: 7, headSha: H1, failures: [], followUp: "fix" }) }
          : {},
    });
    c.d.start();
    await settle();
    assert.equal(c.of(A).state, "running");
    const started = Date.now();
    await c.d.cancel(A);
    assert.ok(Date.now() - started < 1000, `cancel took ${Date.now() - started}ms`);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, true, "the abort reached the prompt");
    assert.deepEqual(c.results, [[A, "cancelled"]]);
  }
});

// 3 MAJOR: salvage that moves the pull request's head after the gate never releases dependents unverified.
const moved = (commit) => ({ branch: "crew/x", commit, committed: commit, changed: 1, upToDate: false });
const green = (headSha) => ({
  state: "success",
  pullNumber: 7,
  headSha,
  checks: [{ name: "ci", conclusion: "success" }],
});

test("salvage that pushes after a green check has its new head checked before dependents start", async () => {
  const verified = [];
  const salvages = [moved(H2), { branch: "crew/x", commit: H2, changed: 0, upToDate: true }];
  const c = crew({
    members: [
      { handle: A, task: "a" },
      { handle: B, task: "b", dependsOn: [A] },
    ],
    script: { [A]: [withPr("completed")] },
    agentOf: (handle) =>
      handle === A
        ? {
            verify: async ({ result: r }) => (
              verified.push(r.evidence.pushed.commit), green(verified.length === 1 ? H1 : H2)
            ),
            salvage: async () => salvages.shift(),
          }
        : {},
  });
  c.d.start();
  await settle();
  assert.deepEqual(verified, [H1, H2], "the salvaged head was checked again");
  assert.deepEqual([c.of(A).state, c.of(A).ci.headSha, c.of(A).ci.current], ["completed", H2, true]);
  assert.equal(c.of(B).state, "completed", "B starts only on a verified head");
});

test("a salvaged head that cannot be verified is not completed and does not release dependents", async () => {
  let checks = 0;
  const c = crew({
    members: [
      { handle: A, task: "a" },
      { handle: B, task: "b", dependsOn: [A] },
    ],
    script: { [A]: [withPr("completed")] },
    agentOf: (handle) =>
      handle === A
        ? {
            verify: async () => {
              checks += 1;
              if (checks > 1) throw new Error("checks unreadable");
              return green(H1);
            },
            salvage: async () => moved(H2),
          }
        : {},
  });
  c.d.start();
  await settle();
  assert.equal(c.of(A).state, "needs_input");
  assert.notEqual(c.of(A).ci.current && c.of(A).ci.state === "success", true, "never a current green");
  assert.equal(c.of(B).state, "held");
});

test("salvage that keeps moving the head ends in a question for Main, with the CI snapshot not current", async () => {
  let n = 0;
  const c = crew({
    members: [
      { handle: A, task: "a" },
      { handle: B, task: "b", dependsOn: [A] },
    ],
    script: { [A]: [withPr("completed")] },
    agentOf: (handle) =>
      handle === A ? { verify: async () => green(H1), salvage: async () => moved(String(++n).repeat(40)) } : {},
  });
  c.d.start();
  await settle();
  assert.equal(c.of(A).state, "needs_input");
  assert.equal(c.of(A).ci.current, false);
  assert.equal(c.of(B).state, "held");
});

// (f) the handoff's CI history and the status agree that the snapshot is no longer current.
test("after a handoff the status CI snapshot is not current, as in the handoff record", async () => {
  const c = crew({
    members: [{ handle: A, task: "a" }],
    script: { [A]: [withPr("completed")] },
    agentOf: () => ({ verify: async () => ({ ...green(H1), gateFiles: [".github/workflows/ci.yml"] }) }),
  });
  c.d.start();
  await settle();
  assert.deepEqual([c.of(A).state, c.of(A).ci.current], ["needs_input", true]);
  const handoff = await c.d.handoff(A, { unmet: ["accepted checks"] });
  assert.equal(handoff.evidence.ci.current, false);
  assert.equal(c.of(A).ci.current, false);
});

// (i) mutation survivors.
test("an agent created after its cancel timed out is still released", async () => {
  const created = deferred();
  const disposed = [];
  const results = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    cancelMs: 30,
    onResult: (handle, r) => results.push([handle, r.status]),
    createAgent: async () => {
      await created.promise;
      return {
        run: { prompt: async () => result("completed"), abort: async () => {} },
        dispose: async () => disposed.push(A),
      };
    },
  });
  d.start();
  await settle();
  await d.cancel(A);
  assert.equal(d.status()[0].state, "cancelled");
  created.resolve();
  await settle();
  assert.deepEqual(disposed, [A]);
  assert.deepEqual(results, [[A, "cancelled"]], "reported once, by the cancel");
});

test("a cancel that times out frees the slot: the next member starts and the crew goes idle", async () => {
  const idle = [];
  const c = crew({
    members: [
      { handle: A, task: "a" },
      { handle: C, task: "c" },
    ],
    maxParallel: 1,
    cancelMs: 30,
    onIdle: (snapshot) => idle.push(snapshot),
    script: { [A]: [() => new Promise(() => {})] },
  });
  c.d.start();
  await settle();
  assert.equal(c.of(C).state, "queued");
  await c.d.cancel(A);
  await settle();
  assert.equal(c.of(C).state, "completed");
  assert.ok(idle.length >= 1, "Main is told the crew settled");
});

test("a salvage that fails because of the cancel is not attempted a second time", async () => {
  const entered = deferred();
  const release = deferred();
  const salvaged = [];
  const c = crew({
    members: [{ handle: A, task: "a" }],
    agentOf: () => ({
      salvage: async (status) => {
        salvaged.push(status);
        entered.resolve();
        await release.promise;
        throw new Error("salvage interrupted");
      },
    }),
  });
  c.d.start();
  await entered.promise;
  const cancelling = c.d.cancel(A);
  release.resolve();
  await cancelling;
  await settle();
  assert.deepEqual(salvaged, ["completed"]);
  assert.deepEqual(c.results, [[A, "cancelled"]]);
});
