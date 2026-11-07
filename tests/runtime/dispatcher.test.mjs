import { strict as assert } from "node:assert";
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
