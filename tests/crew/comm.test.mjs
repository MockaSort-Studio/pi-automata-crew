// tests/crew/comm.test.mjs
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginClose,
  closeDiscussion,
  finishClose,
  markDiscussionClosed,
  postComment,
  assertSubstantive,
  readRoster,
  reconcileAbsentMembers,
  registerMembers,
  unregisterMembers,
  resolveRecipient,
  resolveReplyTarget,
  signedBody,
  writeRoster,
} from "../../.pi/extensions/hall-crew/crew/lib/comm.mjs";

let tmpDir;
const roster = {
  runId: "test-run",
  topic: "crew.test-run",
  owner: "org",
  repo: "repo",
  status: "started",
  discussionNumber: 42,
  discussionUrl: "https://github.com/org/repo/discussions/42",
  members: [
    { name: "architect-tomashco", actorId: "actor-a", role: "architect" },
    { name: "developer-snowball", actorId: "actor-b", role: "developer" },
  ],
};

test("roster round-trips", () => {
  tmpDir = mkdtempSync(join(tmpdir(), "crew-test-"));
  const path = join(tmpDir, "roster.json");
  writeRoster(path, roster);
  assert.deepEqual(readRoster(path), roster);
});

test("recipient requires one exact canonical role-persona handle", () => {
  assert.equal(resolveRecipient(roster, "@architect-tomashco").actorId, "actor-a");
  assert.equal(
    resolveRecipient({ ...roster, lead: { name: "lead-old-major", actorId: "actor-lead" } }, "lead-old-major").actorId,
    "actor-lead",
  );
  assert.throws(() => resolveRecipient(roster, "developer"), /role-persona handle/);
  assert.throws(() => resolveRecipient(roster, "advisor-wizard"), /not found/);
});

test("Lead registers members idempotently and rejects identity conflicts", () => {
  const withLead = { ...roster, lead: { name: "lead-old-major", actorId: "lead-1" }, members: [] };
  const member = { name: "architect-tomashco", actorId: "actor-a", role: "architect" };
  const registered = registerMembers(withLead, "lead-old-major", [member]);
  assert.deepEqual(registered.members, [member]);
  assert.deepEqual(registerMembers(registered, "lead-old-major", [member]).members, [member]);
  assert.throws(() => registerMembers(registered, "advisor-wizard", [member]), /Only the Crew Lead/);
  assert.throws(
    () => registerMembers(registered, "lead-old-major", [{ ...member, actorId: "actor-b" }]),
    /another actor/,
  );
});

test("Lead unregisters removed members idempotently", () => {
  const withLead = { ...roster, lead: { name: "lead-old-major", actorId: "lead-1" } };
  assert.throws(
    () => unregisterMembers(withLead, "lead-old-major", [{ actorId: "actor-b", removed: false }]),
    /verified/,
  );
  const next = unregisterMembers(withLead, "lead-old-major", [{ actorId: "actor-b", removed: true }]);
  assert.deepEqual(
    next.members.map((member) => member.actorId),
    ["actor-a"],
  );
  assert.equal(next.cleanup.at(-1).outcome, "removed");
  assert.throws(
    () => unregisterMembers(withLead, "advisor-wizard", [{ actorId: "actor-b", removed: true }]),
    /Only the Crew Lead/,
  );
});

test("absence reconciliation is audited and bounded to rostered actors", () => {
  const withLead = { ...roster, lead: { name: "lead-old-major", actorId: "lead-1" } };
  const closing = { ...withLead, status: "closing" };
  const next = reconcileAbsentMembers(closing, "lead-old-major", ["actor-b"], "2026-09-03T00:00:00Z");
  assert.deepEqual(
    next.members.map((member) => member.actorId),
    ["actor-a"],
  );
  assert.deepEqual(next.cleanup.at(-1), { actorId: "actor-b", outcome: "absent", observedAt: "2026-09-03T00:00:00Z" });
  assert.throws(() => reconcileAbsentMembers(withLead, "lead-old-major", ["actor-b"], "now"), /only while closing/);
  assert.throws(() => reconcileAbsentMembers(closing, "advisor-wizard", ["actor-b"], "now"), /Only the Crew Lead/);
  assert.throws(() => reconcileAbsentMembers(closing, "lead-old-major", ["unknown"], "now"), /unrostered/);
});

test("human replies resolve to the thread root", () => {
  const pending = {
    ...roster,
    pendingHumanRequests: [{ id: "human-child", replyToId: "crew-root", threadRootId: "crew-root" }],
  };
  assert.equal(resolveReplyTarget(pending, "human-child"), "crew-root");
  assert.equal(resolveReplyTarget(pending, "crew-root"), "crew-root");
});

test("closure reaches terminal state only after verified specialist cleanup", () => {
  const active = { ...roster, completionMode: "human-gated", lead: { name: "lead-old-major", actorId: "lead-1" } };
  assert.throws(() => beginClose(active, "lead-old-major", "2026-09-03T00:00:00Z"), /GitHub-confirmed/);
  const closing = beginClose(active, "lead-old-major", "2026-09-03T00:00:00Z", {
    closed: true,
    closedAt: "2026-09-03T00:00:00Z",
  });
  assert.equal(closing.status, "closing");
  assert.throws(() => finishClose(closing, "lead-old-major"), /All specialists/);
  const empty = unregisterMembers(closing, "lead-old-major", [
    { actorId: "actor-a", removed: true },
    { actorId: "actor-b", removed: true },
  ]);
  assert.equal(finishClose(empty, "lead-old-major").status, "done");
});

test("unattended Crews cannot close without published acceptance", () => {
  const active = { ...roster, lead: { name: "lead-old-major", actorId: "lead-1" } };
  assert.throws(() => beginClose(active, "lead-old-major", "2026-09-03T00:00:00Z"), /crew_close before closing/);
  const accepted = { ...active, finalCommentId: "final-1" };
  assert.equal(beginClose(accepted, "lead-old-major", "2026-09-03T00:00:00Z").status, "closing");
});

test("done Crews reject late registration and Discussion mutations", () => {
  const failed = { ...roster, status: "done", lead: { name: "lead-old-major", actorId: "lead-1" } };
  assert.throws(
    () =>
      registerMembers(failed, "lead-old-major", [
        { name: "architect-tomashco", actorId: "actor-a", role: "architect" },
      ]),
    /active Crew/,
  );
  assert.throws(
    () =>
      signedBody(failed, "lead-old-major", "A substantive finding", "— [Hall-Master | 🦉 Old Major] · no late writes."),
    /active Crew/,
  );
});

test("Discussion close stays non-terminal while specialists remain", () => {
  const closed = markDiscussionClosed(roster, { closed: true, closedAt: "2026-09-01T00:00:00Z" });
  assert.equal(closed.status, "closing");
  assert.equal(
    markDiscussionClosed({ ...roster, members: [] }, { closed: true, closedAt: "2026-09-01T00:00:00Z" }).status,
    "done",
  );
  assert.equal(closed.discussionClosed, true);
  assert.throws(() => markDiscussionClosed(roster, { closed: false }), /did not report/);
});

test("directed crew messages reject URL-only payloads", () => {
  assert.throws(() => assertSubstantive("https://github.com/org/repo/discussions/42"), /substantive/);
  assert.throws(() => assertSubstantive("DONE"), /substantive/);
  assert.doesNotThrow(() => assertSubstantive("Please review the evidence at https://example.test/comment/1"));
});

test("signed posts preserve the persona signature", () => {
  const r = { ...roster, lead: { name: "lead-old-major", actorId: "actor-lead", role: "lead" } };
  assert.match(
    signedBody(
      r,
      "lead-old-major",
      "ACCEPT: evidence is sufficient",
      "— [Hall-Master | 🦉 Old Major] · the work is finally facing forward.",
    ),
    /Hall-Master/,
  );
  assert.throws(() => signedBody(r, "advisor-wizard", "This is substantive", "— wizard"), /Unknown Crew sender/);
});

test("Discussion replies carry replyToId and close preserves the record", () => {
  const bin = join(tmpDir, "bin");
  mkdirSync(bin);
  const log = join(tmpDir, "gh.log");
  const script = join(bin, "gh");
  writeFileSync(
    script,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CREW_GH_LOG"
case "$*" in
  *"discussion(number:"*) printf 'DISCUSSION_ID' ;;
  *"addDiscussionComment"*) printf '{"id":"COMMENT_ID","url":"https://example.test/comment"}' ;;
  *"closeDiscussion"*) printf '{"url":"https://example.test/discussion","closed":true,"closedAt":"2026-08-31T00:00:00Z"}' ;;
esac
`,
  );
  chmodSync(script, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.CREW_GH_LOG = log;
  try {
    const comment = postComment(roster, "@architect-tomashco\\n\\nA substantive threaded response.", "PARENT_ID");
    assert.deepEqual(comment, { id: "COMMENT_ID", url: "https://example.test/comment" });
    assert.equal(closeDiscussion(roster).closed, true);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /replyToId:\$reply/);
    assert.match(calls, /reply=PARENT_ID/);
    assert.match(calls, /closeDiscussion/);
  } finally {
    process.env.PATH = oldPath;
    delete process.env.CREW_GH_LOG;
  }
});

test("cleanup", () => rmSync(tmpDir, { recursive: true, force: true }));
