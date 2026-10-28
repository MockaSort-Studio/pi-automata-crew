import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  discussionStateFilePath,
  postDiscussionClosingComment,
} from "../../.pi/extensions/hall-crew/crew-runtime/lib/github-discussion.mjs";
import { closeTerminalRosterDiscussions } from "../../.pi/extensions/hall-crew/crew-runtime/lib/roster-discussion-close.mjs";

function fakeGh(dir, log) {
  const script = join(dir, "gh");
  writeFileSync(
    script,
    `#!/bin/sh
printf '%s\\0' "$*" >> "${log}"
case "$*" in
  *"addDiscussionComment"*) printf '{"data":{"addDiscussionComment":{"comment":{"id":"C1","url":"https://example.test/c/1"}}}}' ;;
esac
`,
  );
  chmodSync(script, 0o755);
}

function withFakeGh(t) {
  const dir = mkdtempSync(join(tmpdir(), "gh-close-"));
  const log = join(dir, "gh.log");
  fakeGh(dir, log);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  t.after(() => {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, log };
}

const postCount = (log) =>
  readFileSync(log, "utf8")
    .split("\0")
    .filter((c) => c.includes("addDiscussionComment")).length;

test("postDiscussionClosingComment is a no-op when the run never had a Discussion", async (t) => {
  const { dir } = withFakeGh(t);
  const result = await postDiscussionClosingComment(join(dir, "missing-github-discussion.json"), { status: "done" });
  assert.deepEqual(result, { posted: false, reason: "no-discussion" });
});

test("postDiscussionClosingComment posts once and marks the state file closed", async (t) => {
  const { dir, log } = withFakeGh(t);
  const stateFile = discussionStateFilePath(dir, "run-1");
  writeFileSync(stateFile, JSON.stringify({ id: "DISC1", owner: "o", repo: "r", number: 1, seen: [] }));

  const first = await postDiscussionClosingComment(stateFile, { status: "done" });
  assert.equal(first.posted, true);
  assert.equal(postCount(log), 1);

  const second = await postDiscussionClosingComment(stateFile, { status: "done" });
  assert.deepEqual(second, { posted: false, reason: "already-closed" });
  assert.equal(postCount(log), 1);

  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.closedRosterStatus, "done");
  assert.ok(state.closedAt);
});

test("closeTerminalRosterDiscussions only closes runs whose roster is actually terminal", async (t) => {
  const { dir, log } = withFakeGh(t);
  writeFileSync(join(dir, "run-open-roster.json"), JSON.stringify({ runId: "run-open", status: "started" }));
  writeFileSync(join(dir, "run-done-roster.json"), JSON.stringify({ runId: "run-done", status: "done" }));
  writeFileSync(
    discussionStateFilePath(dir, "run-done"),
    JSON.stringify({ id: "DISC2", owner: "o", repo: "r", number: 2, seen: [] }),
  );

  const results = await closeTerminalRosterDiscussions(dir, ["run-open", "run-done", "run-missing"]);
  assert.deepEqual(
    results.map((r) => r.runId),
    ["run-done"],
  );
  assert.equal(results[0].posted, true);
  assert.equal(postCount(log), 1);
});

test("closeTerminalRosterDiscussions de-duplicates repeated run IDs", async (t) => {
  const { dir, log } = withFakeGh(t);
  writeFileSync(join(dir, "run-a-roster.json"), JSON.stringify({ runId: "run-a", status: "done" }));
  writeFileSync(
    discussionStateFilePath(dir, "run-a"),
    JSON.stringify({ id: "DISC3", owner: "o", repo: "r", number: 3, seen: [] }),
  );

  const results = await closeTerminalRosterDiscussions(dir, ["run-a", "run-a"]);
  assert.equal(results.length, 1);
  assert.equal(postCount(log), 1);
});
