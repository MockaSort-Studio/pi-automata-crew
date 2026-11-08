import { strict as assert } from "node:assert";
import test from "node:test";
import { verifyPullRequest } from "../../extensions/crew/runner/ci-verify.mjs";
import { gateCode } from "../../extensions/crew/runner/dispatcher-ci.mjs";
import { createDispatcher } from "../../extensions/crew/runner/dispatcher.mjs";

// A member recovered after a handoff continues its existing pull request in a new session whose own evidence is
// empty (an AgentRun starts with none). The CI gate must still verify that pull request's current head: the
// runner-recorded evidence of the earlier session is carried, never anything the model or Main wrote.
const A = "developer-alpha-00";
const B = "developer-bravo-00";
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const PR = "https://github.com/o/r/pull/7";
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const empty = () => ({ commits: [], pushed: undefined, pullRequest: undefined });
const done = (evidence) => ({ status: "completed", finalText: "done", evidence });
const opened = () => done({ commits: [H1], pushed: { branch: "crew/r/a", commit: H1 }, pullRequest: PR });
const run = (conclusion) => [
  { __typename: "CheckRun", workflowName: "CI", name: "test", status: "COMPLETED", conclusion, detailsUrl: "u" },
];

// The pull request as GitHub would answer it; `github.state` is changed by each test.
function world(sessions) {
  const github = { head: H1, rollup: run("FAILURE"), files: ["src/x.mjs"], viewed: [], unreadable: false };
  const ops = {
    call: async (name, args) => {
      if (name === "github_pull_request_view") {
        github.viewed.push(args.pullNumber);
        if (github.unreadable) throw new Error("rate limited");
        return { state: "OPEN", headRefOid: github.head, statusCheckRollup: github.rollup };
      }
      if (name === "github_pull_request_files")
        return github.files.map((filename) => ({ filename, blob_url: `https://github.com/o/r/blob/${github.head}/x` }));
      throw new Error(`unexpected ${name}`);
    },
  };
  const created = [];
  const prompts = [];
  const createAgent = async ({ handle }) => {
    created.push(handle);
    const outcomes = handle === A ? sessions.shift() : [done(empty())];
    if (outcomes === "unavailable") throw new Error("VM failed to start");
    return {
      run: { prompt: async (text) => (prompts.push([handle, text]), outcomes.shift()), abort: async () => {} },
      // As member-agent wires it: the PR comes only from the result's evidence.
      verify:
        handle === A
          ? ({ result, signal }) =>
              verifyPullRequest({ ops, policy: { repo: "o/r" }, evidence: result.evidence, signal, pollIntervalMs: 1 })
          : undefined,
      dispose: async () => {},
    };
  };
  const d = createDispatcher({
    members: [
      { handle: A, task: "do A" },
      { handle: B, task: "do B", dependsOn: [A] },
    ],
    maxCiRounds: 1,
    createAgent,
  });
  const of = (handle) => d.status().find((m) => m.handle === handle);
  return { d, github, created, prompts, of };
}

async function handedOff(w) {
  w.d.start();
  await settle();
  assert.equal(w.of(A).state, "needs_input", "red CI on the original session");
  await w.d.handoff(A, { unmet: ["green CI"] });
  w.github.viewed.length = 0;
}

test("a recovered member that keeps the same pull request is still held to its red CI", async () => {
  const w = world([
    [opened(), opened()],
    [done(empty()), done(empty())],
  ]);
  await handedOff(w);
  w.d.message(A, "recover: fix the test on the same PR");
  await settle();
  assert.deepEqual(w.github.viewed, [7, 7], "the existing pull request was verified, twice");
  assert.deepEqual([w.of(A).state, w.of(A).ci.state, w.of(A).ci.headSha], ["needs_input", "failure", H1]);
  assert.equal(w.created.includes(B), false, "the dependent stays held");
  assert.equal(w.of(B).state, "held");
});

test("unreadable CI after recovery does not complete the member", async () => {
  const w = world([[opened(), opened()], [done(empty())]]);
  await handedOff(w);
  w.github.unreadable = true;
  w.d.message(A, "recover");
  await settle();
  assert.deepEqual([w.of(A).state, w.of(A).ci.state], ["needs_input", "unavailable"]);
  assert.equal(w.created.includes(B), false);
});

test("a changed head after recovery is freshly verified and its changed checks need Main's exact accept", async () => {
  const w = world([
    [opened(), opened()],
    [done(empty()), done(empty())],
  ]);
  await handedOff(w);
  w.github.head = H2;
  w.github.rollup = run("SUCCESS");
  w.github.files = [".prettierignore"];
  w.d.message(A, "recover");
  await settle();
  assert.deepEqual([w.of(A).state, w.of(A).ci.state, w.of(A).ci.headSha], ["needs_input", "success", H2]);
  assert.equal(w.created.includes(B), false, "green on a new head is not enough while the checks changed");
  w.d.message(A, `accept ${gateCode(H2, [".prettierignore"])}`);
  await settle();
  assert.deepEqual([w.of(A).state, w.of(A).ci.headSha], ["completed", H2]);
  assert.equal(w.of(B).state, "completed", "released only after the current head was verified and accepted");
});

test("a recovery whose new session fails to start keeps the evidence, so the retry is still held to the PR", async () => {
  const w = world([[opened(), opened()], "unavailable", [done(empty()), done(empty())]]);
  await handedOff(w);
  w.d.message(A, "recover");
  await settle();
  assert.equal(w.of(A).state, "failed", "the new session could not start");
  w.d.message(A, "retry the recovery");
  await settle();
  assert.deepEqual(w.github.viewed, [7, 7], "the retry verified the existing pull request");
  assert.deepEqual([w.of(A).state, w.of(A).ci.state, w.of(A).ci.headSha], ["needs_input", "failure", H1]);
  assert.equal(w.created.includes(B), false, "the dependent stays held");
  const handoff = await w.d.handoff(A, { unmet: ["green CI"] });
  assert.deepEqual([handoff.evidence.pullRequest, handoff.evidence.pushed.commit], [PR, H1], "still in the handoff");
});
