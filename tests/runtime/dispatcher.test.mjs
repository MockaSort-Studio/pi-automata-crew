import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDispatcher } from "../../extensions/crew/runner/dispatcher.mjs";

const A = "developer-alpha-00";
const B = "developer-bravo-00";
const C = "reviewer-charlie-00";
const result = (status, extra = {}) => ({ status, finalText: `${status} text`, usage: {}, evidence: {}, ...extra });

// A scripted agent: each prompt takes the next scripted outcome and can be held open until released.
function world(script, { salvage } = {}) {
  const log = [];
  const gates = new Map();
  const agents = {};
  const createAgent = async (member) => {
    log.push(`create ${member.handle}`);
    const outcomes = [...(script[member.handle] ?? [result("completed")])];
    const agent = {
      prompts: [],
      aborted: false,
      run: {
        async prompt(text) {
          agent.prompts.push(text);
          log.push(`prompt ${member.handle}`);
          if (gates.has(member.handle)) await gates.get(member.handle).promise;
          if (agent.aborted) return result("cancelled");
          return outcomes.shift() ?? result("completed");
        },
        async abort() {
          agent.aborted = true;
          gates.get(member.handle)?.release();
        },
      },
      salvage: salvage && ((status) => salvage(member.handle, status)),
      async dispose() {
        log.push(`dispose ${member.handle}`);
      },
    };
    agents[member.handle] = agent;
    return agent;
  };
  const hold = (handle) => {
    let release;
    const promise = new Promise((resolve) => (release = resolve));
    gates.set(handle, { promise, release });
    return () => release();
  };
  return { log, createAgent, agents, hold };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const reported = () => {
  const results = [];
  const idle = [];
  return { results, idle, onResult: (handle, r) => results.push([handle, r.status]), onIdle: (s) => idle.push(s) };
};
const members = [
  { handle: A, task: "do A", dependsOn: [] },
  { handle: B, task: "do B", dependsOn: [A] },
  { handle: C, task: "review", dependsOn: [B] },
];

test("members run in dependency order and each gets its prerequisites' results", async () => {
  const w = world({
    [A]: [result("completed", { finalText: "A built the thing", evidence: { pullRequest: "https://pr/1" } })],
  });
  const r = reported();
  const dispatcher = createDispatcher({ members, createAgent: w.createAgent, ...r });
  dispatcher.start();
  await settle();
  assert.deepEqual(r.results, [
    [A, "completed"],
    [B, "completed"],
    [C, "completed"],
  ]);
  assert.deepEqual(
    w.log.filter((l) => l.startsWith("prompt")),
    [`prompt ${A}`, `prompt ${B}`, `prompt ${C}`],
  );
  assert.equal(w.agents[A].prompts[0], "do A", "a root gets just its task");
  assert.match(w.agents[B].prompts[0], /^do B\n\n## PREREQUISITE RESULTS/);
  assert.match(w.agents[B].prompts[0], /### developer-alpha-00\nA built the thing[\s\S]*https:\/\/pr\/1/);
  assert.equal(r.idle.length >= 1, true, "Main is told when nothing is running");
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["completed", "completed", "completed"],
  );
});

test("independent members run in parallel up to the cap, and the rest wait for a slot", async () => {
  const solo = ["developer-a-00", "developer-b-00", "developer-c-00"].map((handle) => ({
    handle,
    task: handle,
    dependsOn: [],
  }));
  const w = world({});
  const releases = solo.map((m) => w.hold(m.handle));
  const dispatcher = createDispatcher({ members: solo, createAgent: w.createAgent, maxParallel: 2 });
  dispatcher.start();
  await settle();
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["running", "running", "queued"],
    "two at a time",
  );
  releases[0]();
  await settle();
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["completed", "running", "running"],
    "a freed slot starts the next",
  );
  releases[1]();
  releases[2]();
  await settle();
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["completed", "completed", "completed"],
  );
});

test("a member that asks a question holds its dependents; Main's answer resumes the same conversation and releases them", async () => {
  const w = world({
    [A]: [result("needs_input", { question: "which file?" }), result("completed", { finalText: "used x.txt" })],
  });
  const r = reported();
  const dispatcher = createDispatcher({ members, createAgent: w.createAgent, ...r });
  dispatcher.start();
  await settle();
  assert.deepEqual(r.results, [[A, "needs_input"]]);
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["needs_input", "held", "held"],
  );
  dispatcher.message(A, "x.txt");
  await settle();
  assert.deepEqual(w.agents[A].prompts, ["do A", "x.txt"], "the same agent received the answer");
  assert.equal(w.log.filter((l) => l === `create ${A}`).length, 1, "no new agent was created");
  assert.deepEqual(
    r.results.map(([, s]) => s),
    ["needs_input", "completed", "completed", "completed"],
  );
  assert.match(w.agents[B].prompts[0], /used x\.txt/);
});

test("a failed member can be retried by a message, and only then are its dependents released", async () => {
  const w = world({ [A]: [result("failed", { failure: { category: "rate_limit_or_quota" } }), result("completed")] });
  const r = reported();
  const dispatcher = createDispatcher({ members, createAgent: w.createAgent, ...r });
  dispatcher.start();
  await settle();
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["failed", "held", "held"],
    "nothing downstream ran on a failed prerequisite",
  );
  assert.equal(w.agents[B], undefined);
  dispatcher.message(A, "the limit is lifted; continue");
  await settle();
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["completed", "completed", "completed"],
  );
});

test("a completed member can be asked a follow-up without touching the ordering", async () => {
  const w = world({ [A]: [result("completed"), result("completed", { finalText: "revised" })] });
  const dispatcher = createDispatcher({ members: [members[0]], createAgent: w.createAgent });
  dispatcher.start();
  await settle();
  dispatcher.message(A, "please revise");
  await settle();
  assert.deepEqual(w.agents[A].prompts, ["do A", "please revise"]);
  assert.equal(dispatcher.status()[0].state, "completed");
});

test("messaging an unknown, running or not-yet-reported member is refused", async () => {
  const w = world({});
  const release = w.hold(A);
  const dispatcher = createDispatcher({ members, createAgent: w.createAgent });
  dispatcher.start();
  await settle();
  assert.throws(() => dispatcher.message("nobody-x-00", "hi"), /Unknown member/);
  assert.throws(() => dispatcher.message(A, "hi"), /is running/);
  assert.throws(() => dispatcher.message(B, "hi"), /is queued/);
  release();
  await settle();
});

test("cancelling aborts the running member, salvages it, and holds what depends on it", async () => {
  const salvaged = [];
  const w = world(
    {},
    { salvage: (handle, status) => (salvaged.push([handle, status]), { branch: "crew/x", committed: "abc" }) },
  );
  w.hold(A);
  const r = reported();
  const dispatcher = createDispatcher({ members, createAgent: w.createAgent, ...r });
  dispatcher.start();
  await settle();
  await dispatcher.cancel(A);
  assert.equal(w.agents[A].aborted, true);
  assert.deepEqual(r.results, [[A, "cancelled"]]);
  assert.deepEqual(salvaged, [[A, "cancelled"]], "work in progress is salvaged on cancel");
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["cancelled", "held", "held"],
  );
  await dispatcher.cancel();
  assert.deepEqual(
    dispatcher.status().map((s) => s.state),
    ["cancelled", "cancelled", "cancelled"],
    "cancelling the crew ends members that never started",
  );
});

test("cancel bounds an unresponsive CI run and ignores its late completion", { timeout: 8000 }, async () => {
  let release;
  let disposed = false;
  const r = reported();
  const dispatcher = createDispatcher({
    members: [members[0]],
    createAgent: async () => ({
      run: { prompt: async () => result("completed"), abort: async () => {} },
      verify: () => new Promise((resolve) => (release = resolve)),
      dispose: async () => (disposed = true),
    }),
    ...r,
  });
  dispatcher.start();
  await settle();
  assert.equal(dispatcher.status()[0].state, "ci");
  await dispatcher.cancel(A);
  assert.equal(dispatcher.status()[0].state, "cancelled");
  assert.equal(dispatcher.status()[0].ledger, "failed");
  await settle();
  assert.equal(disposed, true);
  release({ state: "success" });
  await settle();
  assert.equal(dispatcher.status()[0].state, "cancelled");
  assert.deepEqual(r.results, [[A, "cancelled"]]);
});

test("dispose bounds an unresponsive run", { timeout: 8000 }, async () => {
  const dispatcher = createDispatcher({
    members: [members[0]],
    createAgent: async () => ({
      run: { prompt: () => new Promise(() => {}), abort: async () => {} },
      dispose: async () => {},
    }),
  });
  dispatcher.start();
  await settle();
  await dispatcher.dispose();
});

test("salvage runs after every outcome and is attached to the result without changing it", async () => {
  const seen = [];
  const w = world(
    { [A]: [result("completed")], [B]: [result("failed", { failure: { category: "empty_turn" } })] },
    { salvage: (handle, status) => (seen.push(status), { committed: "c1" }) },
  );
  const results = [];
  const dispatcher = createDispatcher({
    members: members.slice(0, 2),
    createAgent: w.createAgent,
    onResult: (h, r) => results.push(r),
  });
  dispatcher.start();
  await settle();
  assert.deepEqual(seen, ["completed", "failed"]);
  assert.deepEqual(
    results.map((r) => [r.status, r.salvage]),
    [
      ["completed", { committed: "c1" }],
      ["failed", { committed: "c1" }],
    ],
  );
});

test("a member that cannot start fails with a startup error and its message is scrubbed of secrets", async () => {
  const w = world({});
  const results = [];
  const dispatcher = createDispatcher({
    members: [members[0]],
    createAgent: async () => {
      throw new Error("VM failed to boot with token sk-live-123");
    },
    onResult: (h, r) => results.push(r),
    scrub: (text) => text.replaceAll("sk-live-123", "[redacted]"),
  });
  dispatcher.start();
  await settle();
  assert.equal(results[0].status, "failed");
  assert.equal(results[0].failure.category, "startup_error");
  assert.doesNotMatch(JSON.stringify(results[0]), /sk-live/);
  assert.match(results[0].failure.detail, /\[redacted\]/);
  assert.equal(w.log.length, 0);
});

test("dispose aborts running work and disposes every agent", async () => {
  const w = world({});
  w.hold(A);
  const dispatcher = createDispatcher({ members: [members[0]], createAgent: w.createAgent });
  dispatcher.start();
  await settle();
  await dispatcher.dispose();
  assert.equal(w.agents[A].aborted, true);
  assert.ok(w.log.includes(`dispose ${A}`));
  assert.throws(() => dispatcher.message(A, "x"), /disposed/);
});

test("a completed member that fails after a follow-up is not reported as complete", async () => {
  const w = world({ [A]: [result("completed"), result("failed", { failure: { category: "rate_limit_or_quota" } })] });
  const idle = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: w.createAgent,
    onIdle: (m) => idle.push(m),
  });
  d.start();
  await settle();
  assert.deepEqual([d.status()[0].state, d.status()[0].ledger], ["completed", "complete"]);

  d.message(A, "please also handle the edge case");
  await settle();
  assert.deepEqual(
    [d.status()[0].state, d.status()[0].ledger],
    ["failed", "blocked"],
    "the ledger says what really happened",
  );
  assert.equal(idle.at(-1)[0].ledger, "blocked", "so the crew is not announced as complete");

  d.message(A, "try again");
  await settle();
  assert.deepEqual([d.status()[0].state, d.status()[0].ledger], ["completed", "complete"], "and it can still finish");
});

test("a completed member that asks a question after a follow-up holds what has not started", async () => {
  const w = world({
    [A]: [result("completed"), result("needs_input", { question: "which one?" }), result("completed")],
  });
  const members = [
    { handle: A, task: "a" },
    { handle: C, task: "c" },
    { handle: B, task: "b", dependsOn: [A] },
  ];
  // One at a time: after A completes, C takes the only slot, so B is ready but has not started.
  const d = createDispatcher({ members, createAgent: w.createAgent, maxParallel: 1 });
  const release = w.hold(C);
  d.start();
  await settle();
  assert.deepEqual(
    d.status().map((m) => [m.handle, m.state, m.ledger]),
    [
      [A, "completed", "complete"],
      [C, "running", "running"],
      [B, "queued", "ready"],
    ],
  );

  d.message(A, "one more thing");
  await settle();
  assert.deepEqual(
    [d.status()[0].state, d.status()[2].ledger],
    ["needs_input", "blocked"],
    "B is held while its prerequisite asks",
  );
  release();
  await settle();
  assert.equal(w.agents[B], undefined, "B never started on a result that was in question");

  d.message(A, "the first one");
  await settle();
  assert.deepEqual(
    d.status().map((m) => m.state),
    ["completed", "completed", "completed"],
  );
  assert.match(w.agents[B].prompts[0], /completed text/, "B ran after A finished again, and saw its result");
});

// A member that opened a pull request is held to a green CI: `verify` answers with the suite's result.
const ciWorld = ({ checks, outcomes }) => {
  const w = world({ [A]: outcomes ?? [result("completed")] });
  const prompts = [];
  const seen = [];
  const createAgent = async (member) => {
    const agent = await w.createAgent(member);
    const prompt = agent.run.prompt;
    agent.run.prompt = (text) => (prompts.push(text), prompt(text));
    agent.verify = ({ signal }) => {
      seen.push(signal);
      return checks.shift()(signal);
    };
    return agent;
  };
  return { ...w, createAgent, prompts, seen };
};
const green = () => async () => ({
  state: "success",
  pullNumber: 7,
  checks: [{ name: "CI / test", conclusion: "success" }],
  waitedSeconds: 90,
});
const red =
  (name = "CI / test") =>
  async () => ({ state: "failure", pullNumber: 7, failures: [{ name, url: "u" }], followUp: `CI is red: ${name}` });

test("a member whose CI is green completes, and the report says so", async () => {
  const w = ciWorld({ checks: [green()] });
  const results = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: w.createAgent,
    onResult: (h, r) => results.push(r),
  });
  d.start();
  await settle();
  assert.equal(d.status()[0].state, "completed");
  assert.equal(w.seen.length, 1, "CI was actually checked");
  assert.deepEqual(w.prompts, ["a"], "nothing was added to the conversation");
  assert.deepEqual([results[0].ci.state, results[0].ci.rounds, results[0].ci.pullNumber], ["success", 1, 7]);
});

test("red CI resumes the same session with what failed, until it is green", async () => {
  const results = [];
  const w = ciWorld({
    checks: [red("CI / test"), red("CI / format"), green()],
    outcomes: [result("completed"), result("completed"), result("completed")],
  });
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: w.createAgent,
    onResult: (h, r) => results.push(r),
  });
  d.start();
  await settle();
  assert.deepEqual(
    w.prompts,
    ["a", "CI is red: CI / test", "CI is red: CI / format"],
    "each red result became a message to the same session",
  );
  assert.equal(results.length, 1, "Main hears about it once, at the end");
  assert.equal(results[0].status, "completed");
  assert.deepEqual(
    [results[0].ci.state, results[0].ci.rounds, results[0].ci.checks],
    ["success", 3, [{ name: "CI / test", conclusion: "success" }]],
  );
  assert.equal(d.status()[0].state, "completed");
});

test("the member is visibly waiting for CI, and cancelling ends the wait promptly", async () => {
  let release;
  const waiting = new Promise((resolve) => (release = resolve));
  const w = ciWorld({
    checks: [
      (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("Cancelled while waiting for checks"))),
        ),
    ],
  });
  const results = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: w.createAgent,
    onResult: (h, r) => results.push(r),
  });
  d.start();
  await settle();
  assert.deepEqual([d.status()[0].state, d.status()[0].ledger], ["ci", "running"]);
  await d.cancel(A);
  await settle();
  assert.equal(d.status()[0].state, "cancelled");
  assert.equal(results.at(-1).status, "cancelled");
  assert.equal(w.seen[0].aborted, true);
  release();
  await waiting;
});

test("after the allowed attempts the member asks Main instead of looping or silently completing", async () => {
  const w = ciWorld({
    checks: [red(), red(), red(), red()],
    outcomes: [result("completed"), result("completed"), result("completed"), result("completed")],
  });
  const results = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: w.createAgent,
    maxCiRounds: 2,
    onResult: (h, r) => results.push(r),
  });
  d.start();
  await settle();
  assert.deepEqual([d.status()[0].state, d.status()[0].ledger], ["needs_input", "blocked"]);
  assert.match(results[0].question, /CI is still red on pull request #7 after 2 attempts to fix it: CI \/ test/);
  assert.equal(results[0].ci.state, "failure");
  assert.equal(w.prompts.length, 3, "the task and two fix attempts");
});

test("a question while fixing CI stops the loop and goes to Main", async () => {
  const w = ciWorld({
    checks: [red(), green()],
    outcomes: [result("completed"), result("needs_input", { question: "which one?" })],
  });
  const d = createDispatcher({ members: [{ handle: A, task: "a" }], createAgent: w.createAgent });
  d.start();
  await settle();
  assert.equal(d.status()[0].state, "needs_input");
  assert.equal(w.prompts.length, 2);
});

test("CI that cannot be checked, a closed pull request, or no CI at all are each reported honestly", async () => {
  const broken = ciWorld({
    checks: [
      async () => {
        throw new Error("gh exploded");
      },
    ],
  });
  const r1 = [];
  createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: broken.createAgent,
    onResult: (h, r) => r1.push(r),
  }).start();
  await settle();
  assert.equal(r1[0].status, "needs_input");
  assert.match(r1[0].question, /could not check CI.*gh exploded/);

  const closed = ciWorld({ checks: [async () => ({ state: "closed", pullNumber: 7, prState: "MERGED" })] });
  const r2 = [];
  createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: closed.createAgent,
    onResult: (h, r) => r2.push(r),
  }).start();
  await settle();
  assert.match(r2[0].question, /Pull request #7 is merged/);

  const none = ciWorld({ checks: [async () => ({ state: "none", pullNumber: 7 })] });
  const r3 = [];
  createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: none.createAgent,
    onResult: (h, r) => r3.push(r),
  }).start();
  await settle();
  assert.deepEqual(
    [r3[0].status, r3[0].ci.state],
    ["completed", "none"],
    "a repository without CI is not blocked, and the result says so",
  );
});

test("a member with nothing to verify, or that did not complete, is not gated", async () => {
  const w = ciWorld({ checks: [async () => null] });
  const d = createDispatcher({ members: [{ handle: A, task: "a" }], createAgent: w.createAgent });
  d.start();
  await settle();
  assert.equal(d.status()[0].state, "completed", "no pull request in the evidence: nothing to wait for");
  const failedRun = ciWorld({ checks: [], outcomes: [result("failed", { failure: { category: "x" } })] });
  const d2 = createDispatcher({ members: [{ handle: A, task: "a" }], createAgent: failedRun.createAgent });
  d2.start();
  await settle();
  assert.equal(d2.status()[0].state, "failed", "verify was never called for a run that did not complete");
});

const greenWith = (gateFiles) => async () => ({
  state: "success",
  pullNumber: 7,
  checks: [],
  gateFiles,
  headSha: "head",
});

test("a green CI that was made green by changing the checks is reported to Main, not silently completed", async () => {
  const w = ciWorld({ checks: [greenWith([".prettierignore"])] });
  const results = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: w.createAgent,
    onResult: (h, r) => results.push(r),
  });
  d.start();
  await settle();
  assert.deepEqual([d.status()[0].state, d.status()[0].ledger], ["needs_input", "blocked"]);
  assert.match(
    results[0].question,
    /CI is green on pull request #7, but the change touches files that define the checks: \.prettierignore/,
  );
  assert.deepEqual(results[0].ci.gateFiles, [".prettierignore"]);
});

test("once Main has replied, the same files are accepted; a new one is asked about again", async () => {
  const w = ciWorld({
    checks: [
      greenWith([".prettierignore"]),
      greenWith([".prettierignore"]),
      greenWith([".prettierignore", ".github/workflows/ci.yml"]),
    ],
    outcomes: [result("completed"), result("completed"), result("completed")],
  });
  const results = [];
  const d = createDispatcher({
    members: [{ handle: A, task: "a" }],
    createAgent: w.createAgent,
    onResult: (h, r) => results.push(r),
  });
  d.start();
  await settle();
  assert.equal(d.status()[0].state, "needs_input");
  const code = createHash("sha256").update("head\n.prettierignore").digest("hex").slice(0, 8);
  d.message(A, `accept ${code}`);
  await settle();
  assert.equal(d.status()[0].state, "completed", "accepted: it completes");
  assert.deepEqual(results.at(-1).ci.state, "success");
  d.message(A, "now also touch the workflow");
  await settle();
  assert.equal(d.status()[0].state, "needs_input", "a file that was not accepted is asked about");
  assert.deepEqual(results.at(-1).ci.gateFiles, [".github/workflows/ci.yml"], "only the new one");
});
