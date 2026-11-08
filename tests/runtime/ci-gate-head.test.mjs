import { strict as assert } from "node:assert";
import test from "node:test";
import { verifyPullRequest } from "../../extensions/crew/runner/ci-verify.mjs";

const sha = "a".repeat(40);
const other = "b".repeat(40);
const policy = { repo: "o/r" };
const evidence = { pullRequest: "https://github.com/o/r/pull/9", pushed: { commit: sha } };
const file = (head) => ({
  filename: ".prettierignore",
  blob_url: `https://github.com/o/r/blob/${head}/.prettierignore`,
});
const verify = (files, ev = evidence) =>
  verifyPullRequest({
    policy,
    evidence: ev,
    ops: {
      call: async (name) =>
        name === "github_pull_request_view"
          ? { state: "OPEN", headRefOid: sha, statusCheckRollup: [{ __typename: "StatusContext", state: "SUCCESS" }] }
          : files,
    },
  });

test("gate acknowledgement uses the current head and fails closed without a consistent head", async () => {
  assert.equal((await verify([file(sha)])).headSha, sha);
  await assert.rejects(verify([file(other)]), /head/i);
  await assert.rejects(verify([file(sha), file(other)]), /head/i);
  await assert.rejects(verify([{ filename: ".prettierignore" }]), /head/i);
  assert.equal((await verify([file(sha)], { pullRequest: evidence.pullRequest })).headSha, sha);
});
