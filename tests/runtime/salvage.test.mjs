import { strict as assert } from "node:assert";
import test from "node:test";
import { salvage } from "../../extensions/crew/runner/salvage.mjs";

const policy = { repo: "o/r", revision: "a".repeat(40), base: "main", branch: "crew/run/dev" };
const fakeOps = (status, overrides = {}) => {
  const calls = [];
  return {
    calls,
    ops: {
      async call(name, input) {
        calls.push([name, input]);
        if (overrides[name]) return overrides[name](input);
        if (name === "github_git_status") return typeof status === "function" ? status(calls) : status;
        if (name === "github_git_commit") return { commit: "c0ffee" };
        if (name === "github_git_push") return { commit: "c0ffee" };
        return {};
      },
    },
  };
};
const names = (calls) => calls.map(([name]) => name);

test("an agent that never touched Git leaves nothing to rescue and gets no remote branch", async () => {
  const { ops, calls } = fakeOps({ branch: null, files: [] });
  assert.deepEqual(await salvage({ ops, policy, member: "reviewer-x-00", reason: "completed" }), {
    branch: policy.branch,
    skipped: true,
  });
  assert.deepEqual(names(calls), ["github_git_status"]);
});

test("uncommitted work on an agent that never checked out is checked out, committed and pushed", async () => {
  let checkedOut = false;
  const { ops, calls } = fakeOps(
    () => ({ branch: checkedOut ? policy.branch : null, files: [{ path: "a.txt" }, { path: "docs/b.md" }] }),
    {
      github_workspace_checkout: () => ((checkedOut = true), {}),
    },
  );
  const result = await salvage({ ops, policy, member: "developer-x-00", reason: "failed" });
  assert.deepEqual(names(calls), [
    "github_git_status",
    "github_workspace_checkout",
    "github_git_stage",
    "github_git_commit",
    "github_git_push",
  ]);
  assert.deepEqual(calls[1][1], { repo: "o/r", revision: policy.revision, branch: policy.branch });
  assert.deepEqual(calls[2][1], { repo: "o/r", paths: ["a.txt", "docs/b.md"] });
  assert.deepEqual(calls[3][1], { repo: "o/r", message: "wip: salvage developer-x-00 (failed)" });
  assert.deepEqual(calls[4][1], { repo: "o/r", branch: policy.branch });
  assert.deepEqual(result, {
    branch: policy.branch,
    commit: "c0ffee",
    changed: 2,
    committed: "c0ffee",
    upToDate: false,
  });
});

test("committed but unpushed work on the checked-out branch is only pushed", async () => {
  const { ops, calls } = fakeOps(
    { branch: policy.branch, files: [] },
    {
      github_workspace_checkout: () => ({ head: "b".repeat(40) }),
      github_git_push: () => ({ commit: "beef", upToDate: true }),
    },
  );
  const result = await salvage({ ops, policy, member: "developer-x-00", reason: "cancelled" });
  assert.deepEqual(names(calls), ["github_git_status", "github_workspace_checkout", "github_git_push"]);
  assert.deepEqual(result, { branch: policy.branch, commit: "beef", changed: 0, committed: undefined, upToDate: true });
});

test("paths inside .git are never staged, and large changes are staged in chunks", async () => {
  const files = [
    { path: ".git/config" },
    { path: "x/.git/hooks" },
    ...Array.from({ length: 1100 }, (_, i) => ({ path: `f${i}.txt` })),
  ];
  const { ops, calls } = fakeOps({ branch: policy.branch, files });
  const result = await salvage({ ops, policy, member: "developer-x-00", reason: "needs_input" });
  const staged = calls.filter(([name]) => name === "github_git_stage").map(([, input]) => input.paths);
  assert.deepEqual(
    staged.map((paths) => paths.length),
    [500, 500, 100],
  );
  assert.equal(
    staged.flat().some((path) => path.includes(".git")),
    false,
  );
  assert.equal(result.changed, 1100);
});

test("a failing operation is reported beside the run, bounded, and never thrown", async () => {
  const { ops } = fakeOps(
    { branch: policy.branch, files: [{ path: "a" }] },
    {
      github_git_push: () => {
        throw new Error(`push rejected ${"x".repeat(1000)}`);
      },
    },
  );
  const result = await salvage({ ops, policy, member: "developer-x-00", reason: "failed" });
  assert.equal(result.branch, policy.branch);
  assert.match(result.error, /^push rejected/);
  assert.ok(result.error.length <= 300);
});

test("an agent that checked out and changed nothing leaves no empty branch on the remote", async () => {
  const { ops, calls } = fakeOps(
    { branch: policy.branch, files: [] },
    { github_workspace_checkout: () => ({ head: policy.revision }) },
  );
  const result = await salvage({ ops, policy, member: "developer-x-00", reason: "cancelled" });
  assert.deepEqual(result, { branch: policy.branch, skipped: true, reason: "no changes" });
  assert.deepEqual(names(calls), ["github_git_status", "github_workspace_checkout"], "nothing is committed or pushed");
});

test("work that is already committed is pushed even when nothing is uncommitted", async () => {
  const { ops, calls } = fakeOps(
    { branch: policy.branch, files: [] },
    { github_workspace_checkout: () => ({ head: "c".repeat(40) }) },
  );
  const result = await salvage({ ops, policy, member: "developer-x-00", reason: "failed" });
  assert.equal(result.skipped, undefined);
  assert.ok(names(calls).includes("github_git_push"));
});
