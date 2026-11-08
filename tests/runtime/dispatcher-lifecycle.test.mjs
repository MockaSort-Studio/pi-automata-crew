import { strict as assert } from "node:assert";
import test from "node:test";
import { createDispatcher } from "../../extensions/crew/runner/dispatcher.mjs";

// Main's lifecycle decisions (hold, handoff, recovery, cancel) and the one status projection (#136, #139, #140).
const A = "developer-alpha-00";
const B = "developer-bravo-00";
const C = "developer-charlie-00";
const HEAD = "a".repeat(40);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const result = (status, extra = {}) => ({ status, finalText: `${status} text`, evidence: {}, ...extra });
const withPr = (status, extra = {}) =>
  result(status, { evidence: { pullRequest: "https://github.com/o/r/pull/7", pushed: { commit: HEAD } }, ...extra });
const green = async () => ({
  state: "success",
  pullNumber: 7,
  headSha: HEAD,
  checks: [{ name: "ci", conclusion: "success" }],
});
const red = async () => ({
  state: "failure",
  pullNumber: 7,
  headSha: HEAD,
  failures: [{ name: "ci" }],
  followUp: "fix ci",
});

function crew({ outcomes = {}, checks = [], members, dispose = async () => {}, hold = {} } = {}) {
  const created = [];
  const prompts = {};
  const decisions = [];
  const results = [];
  const disposed = [];
  let clock = 0;
  const d = createDispatcher({
    members: members ?? [
      { handle: A, task: "do A" },
      { handle: B, task: "do B", dependsOn: [A] },
    ],
    maxCiRounds: 1,
    now: () => `t${++clock}`,
    onDecision: (handle, decision) => decisions.push([handle, decision]),
    onResult: (handle, r) => results.push([handle, r]),
    createAgent: async ({ handle }) => {
      created.push(handle);
      prompts[handle] ??= [];
      const queue = outcomes[handle] ?? [];
      return {
        run: {
          prompt: async (text) => {
            prompts[handle].push(text);
            await hold[text];
            return queue.shift() ?? result("completed");
          },
          abort: async () => {},
        },
        ...(checks.length && handle === A ? { verify: () => checks.shift()() } : {}),
        dispose: () => (disposed.push(handle), dispose()),
      };
    },
  });
  const of = (handle) => d.status().find((m) => m.handle === handle);
  return { d, created, prompts, decisions, results, disposed, of };
}
const hold = { blocker: "PR #9 must merge first", owner: "developer-bravo-00", resumeWhen: "PR #9 is merged" };

test("a hold is recorded and visible but starts no turn; only an explicit message resumes, exactly once", async () => {
  const c = crew({ outcomes: { [A]: [result("needs_input", { question: "may I proceed?" }), result("completed")] } });
  c.d.start();
  await settle();
  assert.equal(c.prompts[A].length, 1);
  const recorded = c.d.hold(A, { ...hold, refs: { pullRequest: "https://github.com/o/r/pull/9", head: HEAD } });
  await settle();
  await settle();
  assert.equal(c.prompts[A].length, 1, "a hold produced no model turn, and nothing resumed it later");
  assert.equal(c.results.length, 1, "a hold is not a member report");
  assert.deepEqual(c.decisions, [[A, { type: "hold", ...recorded }]]);
  const status = c.of(A);
  assert.equal(status.state, "on_hold");
  assert.equal(status.ledger, "blocked");
  assert.deepEqual(status.hold.refs, { pullRequest: "https://github.com/o/r/pull/9", head: HEAD });
  assert.equal(status.hold.owner, "developer-bravo-00");
  assert.match(status.hold.at, /^t\d+$/);
  assert.deepEqual(status.lastReport, { status: "needs_input", at: "t1", current: false });
  assert.equal(c.of(B).state, "held", "a hold releases nothing");

  c.d.message(A, "PR #9 merged; proceed");
  await settle();
  assert.deepEqual(c.prompts[A], ["do A", "PR #9 merged; proceed"], "exactly one resume, in the same session");
  assert.equal(c.created.filter((h) => h === A).length, 1);
  assert.equal(c.of(A).hold, undefined);
  assert.equal(c.of(B).state, "completed");
});

test("a hold needs a blocker, an owner and a resume condition, and only applies to a member waiting for Main", async () => {
  const c = crew({ outcomes: { [A]: [result("failed", { failure: { category: "x" } })] } });
  assert.throws(() => c.d.hold(A, hold), /queued/);
  c.d.start();
  await settle();
  assert.throws(() => c.d.hold(A, { ...hold, owner: " " }), /owner is required/);
  assert.throws(() => c.d.hold(A, { ...hold, resumeWhen: undefined }), /resumeWhen is required/);
  assert.throws(() => c.d.hold(A, { ...hold, refs: { head: "main" } }), /commit SHA/);
  assert.throws(() => c.d.hold(B, hold), /held/);
  assert.equal(c.d.hold(A, hold).blocker, hold.blocker, "a failed member can be held");
  assert.equal(c.d.hold(A, { ...hold, blocker: "updated" }).blocker, "updated", "a hold can be updated");
  assert.equal(c.decisions.length, 2);
  assert.equal(c.prompts[A].length, 1);
});

test("red CI handed off: VM released, evidence kept, nothing downstream released, no report claimed", async () => {
  const c = crew({ outcomes: { [A]: [withPr("completed"), withPr("completed")] }, checks: [red, red] });
  c.d.start();
  await settle();
  assert.equal(c.of(A).state, "needs_input");
  const handoff = await c.d.handoff(A, { unmet: ["CI green on the latest head"], note: "flaky upstream" });
  assert.equal(handoff.outcome, "partial");
  assert.deepEqual(handoff.unmet, ["CI green on the latest head"]);
  assert.equal(handoff.evidence.pullRequest, "https://github.com/o/r/pull/7");
  assert.deepEqual(handoff.evidence.pushed, { commit: HEAD });
  assert.deepEqual([handoff.evidence.ci.state, handoff.evidence.ci.headSha], ["failure", HEAD]);
  assert.deepEqual(c.disposed, [A], "the VM was released");
  const status = c.of(A);
  assert.deepEqual([status.state, status.ledger], ["handed_off", "blocked"]);
  assert.equal(status.lastReport.current, false);
  assert.equal(status.ci.state, "failure", "the CI snapshot still says red");
  assert.equal(c.of(B).state, "held");
  assert.equal(c.created.includes(B), false, "the dependent never started");
  assert.equal(c.results.length, 1, "a handoff is Main's decision, not a member report");
  assert.equal(c.decisions[0][1].type, "handoff");
  await c.d.cancel(A);
  assert.equal(c.of(A).state, "handed_off", "cancel leaves an ended member alone");
  await c.d.dispose();
  assert.deepEqual(c.disposed, [A], "cleanup does not dispose it twice");
});

test("superseded work is handed off as superseded, and a handoff needs unmet criteria and an idle member", async () => {
  const c = crew({ outcomes: { [A]: [result("needs_input", { question: "?" })] } });
  c.d.start();
  await settle();
  await assert.rejects(c.d.handoff(A, {}), /unmet/);
  await assert.rejects(c.d.handoff(B, { unmet: ["x"] }), /held/);
  const handoff = await c.d.handoff(A, { unmet: ["its own PR"], supersededBy: "https://github.com/o/r/pull/12" });
  assert.equal(handoff.outcome, "superseded");
  assert.equal(c.of(B).ledger, "blocked");
  await assert.rejects(c.d.handoff(A, { unmet: ["x"] }), /handed_off/);
  assert.throws(() => c.d.hold(A, hold), /handed_off/);
});

test("a handed-off member is recovered only by an explicit message, in a new session told what it recovers", async () => {
  const c = crew({ outcomes: { [A]: [result("needs_input", { question: "?" }), result("completed")] } });
  c.d.start();
  await settle();
  await c.d.handoff(A, { unmet: ["tests"] });
  await settle();
  assert.equal(c.created.length, 1);
  c.d.message(A, "recover and finish the tests");
  await settle();
  assert.equal(c.created.filter((h) => h === A).length, 2, "a new VM and session");
  assert.equal(c.prompts[A].length, 2);
  assert.match(
    c.prompts[A][1],
    /^do A\n\n## RECOVERY\n[\s\S]*"unmet":\["tests"\][\s\S]*## MAIN\nrecover and finish the tests$/,
  );
  assert.equal(c.of(A).state, "completed");
  assert.equal(c.of(A).handoff, undefined);
  assert.equal(c.of(B).state, "completed", "released only once the recovered member completed");
});

test("a handoff is bounded when the VM never finishes disposing", { timeout: 8000 }, async () => {
  const c = crew({
    outcomes: { [A]: [result("needs_input", { question: "?" })] },
    dispose: () => new Promise(() => {}),
  });
  c.d.start();
  await settle();
  const started = Date.now();
  await c.d.handoff(A, { unmet: ["x"] });
  assert.ok(Date.now() - started < 6500);
  assert.equal(c.of(A).state, "handed_off");
});

test("cancelling a member that waits for Main ends it in the ledger and releases its VM", async () => {
  const c = crew({ outcomes: { [A]: [result("needs_input", { question: "?" })] } });
  c.d.start();
  await settle();
  c.d.hold(A, hold);
  await c.d.cancel(A);
  await settle();
  const status = c.of(A);
  assert.deepEqual([status.state, status.ledger], ["cancelled", "failed"], "no blocked ledger behind a cancel");
  assert.equal(status.hold, undefined);
  assert.deepEqual(status.lastReport, { status: "needs_input", at: "t1", current: false });
  assert.deepEqual(c.disposed, [A]);
  assert.equal(c.of(B).state, "held");
  assert.throws(() => c.d.message(A, "go"), /cancelled/);
});

test("the CI snapshot names its exact head and time; no checks and unreadable checks are not green", async () => {
  const one = (checks, outcomes) => crew({ members: [{ handle: A, task: "a" }], checks, outcomes: { [A]: outcomes } });
  const ok = one([green], [withPr("completed")]);
  ok.d.start();
  await settle();
  assert.deepEqual(
    [ok.of(A).ci.state, ok.of(A).ci.headSha, ok.of(A).ci.checkedAt, ok.of(A).lastReport.current],
    ["success", HEAD, "t1", true],
  );

  const none = one([async () => ({ state: "none", pullNumber: 7, headSha: HEAD })], [withPr("completed")]);
  none.d.start();
  await settle();
  assert.deepEqual([none.of(A).state, none.of(A).ci.state], ["completed", "none"], "absent, not success");

  const broken = one(
    [
      async () => {
        throw new Error("rate limited");
      },
    ],
    [withPr("completed")],
  );
  broken.d.start();
  await settle();
  assert.deepEqual(
    [broken.of(A).state, broken.of(A).ci.state, broken.of(A).ci.checkedAt],
    ["needs_input", "unavailable", "t1"],
  );
  assert.equal(broken.results[0][1].ci.state, "unavailable", "the report carries it too");
});

test("while a member repairs red CI it is running, with the red snapshot and its earlier report not current", async () => {
  let release;
  const repairing = new Promise((resolve) => (release = resolve));
  const c = crew({
    members: [{ handle: A, task: "a" }],
    checks: [red, green],
    outcomes: { [A]: [withPr("needs_input", { question: "?" })] },
    hold: { "fix ci": repairing },
  });
  c.d.start();
  await settle();
  c.d.message(A, "go on");
  await settle();
  const during = c.of(A);
  assert.deepEqual(
    [during.state, during.ci.state, during.ci.headSha, during.ci.current],
    ["running", "failure", HEAD, false],
    "the red check is history while the member fixes it",
  );
  assert.deepEqual(during.lastReport, { status: "needs_input", at: "t1", current: false });
  release();
  await settle();
  assert.deepEqual(c.prompts[A], ["a", "go on", "fix ci"]);
  const after = c.of(A);
  assert.deepEqual(
    [after.state, after.ci.state, after.ci.rounds, after.lastReport.current, after.ci.current],
    ["completed", "success", 2, true, true],
  );
});

test("a green snapshot is not current once a follow-up or a recovery starts, until CI is checked again", async () => {
  let release;
  const working = new Promise((resolve) => (release = resolve));
  const c = crew({
    members: [{ handle: A, task: "a" }],
    checks: [green, green],
    outcomes: { [A]: [withPr("completed"), withPr("needs_input", { question: "?" })] },
    hold: { "follow up": working },
  });
  c.d.start();
  await settle();
  assert.deepEqual([c.of(A).ci.state, c.of(A).ci.current], ["success", true]);
  c.d.message(A, "follow up");
  await settle();
  assert.deepEqual([c.of(A).state, c.of(A).ci.state, c.of(A).ci.current], ["running", "success", false]);
  release();
  await settle();
  assert.deepEqual([c.of(A).state, c.of(A).ci.current], ["needs_input", false], "no fresh check: still history");
  const handoff = await c.d.handoff(A, { unmet: ["x"] });
  assert.equal(handoff.evidence.ci.current, false, "a handoff carries CI only as history");
});

test("cancelling the whole crew ends every member in the ledger, including one held behind a prerequisite", async () => {
  const c = crew({ outcomes: { [A]: [result("needs_input", { question: "?" })] } });
  c.d.start();
  await settle();
  assert.deepEqual([c.of(B).state, c.of(B).ledger], ["held", "blocked"]);
  await c.d.cancel();
  assert.deepEqual(
    c.d.status().map((m) => [m.state, m.ledger]),
    [
      ["cancelled", "failed"],
      ["cancelled", "failed"],
    ],
  );
});

test("one agent whose disposal throws never stops another's, and a failed disposal is retried at cleanup", async () => {
  const disposed = [];
  let attempts = 0;
  const d = createDispatcher({
    members: [
      { handle: A, task: "a" },
      { handle: B, task: "b" },
      { handle: C, task: "c" },
    ],
    createAgent: async ({ handle }) => ({
      run: { prompt: async () => result(handle === A ? "needs_input" : "completed"), abort: async () => {} },
      dispose:
        handle === A
          ? () => {
              attempts += 1;
              if (attempts === 1) throw new Error("VM busy");
              disposed.push(A);
            }
          : handle === B
            ? () => {
                throw new Error("synchronous failure");
              }
            : () => disposed.push(handle),
    }),
  });
  d.start();
  await settle();
  await d.handoff(A, { unmet: ["x"] });
  assert.equal(attempts, 1, "the handoff tried to release the VM and failed");
  await d.dispose();
  assert.equal(attempts, 2, "cleanup retried it even though another agent's disposal threw synchronously");
  assert.deepEqual(disposed.sort(), [A, C].sort(), "C was disposed after B threw");
});

test("Main's text is recorded whole or refused, never silently shortened", async () => {
  const c = crew({ outcomes: { [A]: [result("needs_input", { question: "?" })] } });
  c.d.start();
  await settle();
  const many = Array.from({ length: 21 }, (_, i) => `criterion ${i}`);
  await assert.rejects(c.d.handoff(A, { unmet: many }), /unmet lists 21 criteria; at most 20/);
  await assert.rejects(c.d.handoff(A, { unmet: ["x".repeat(1001)] }), /unmet\[0\] is longer than 1000 characters/);
  await assert.rejects(c.d.handoff(A, { unmet: ["x"], supersededBy: " " }), /supersededBy must be non-empty text/);
  assert.throws(() => c.d.hold(A, { ...hold, blocker: "y".repeat(1001) }), /blocker is longer than 1000/);
  const long = "z".repeat(1000);
  assert.equal((await c.d.handoff(A, { unmet: [long] })).unmet[0], long);
});
