import { strict as assert } from "node:assert";
import { test } from "node:test";
import { acknowledgeHumanRequests, queueHumanRequests } from "../../.pi/extensions/hall-crew/crew/lib/human-inbox-state.mjs";

const roster = { lead: { name: "lead-old-major" }, members: [{ name: "architect-mergio" }] };
const crew = { id: "crew", body: "Finding\n\n---\n@architect-mergio\nsigned" };
const human = {
  id: "human",
  url: "https://example.test/comment",
  body: "Need a developer second opinion",
  author: { login: "human" },
  replyToId: "crew",
};

test("nested human replies persist until explicitly acknowledged", () => {
  const queued = queueHumanRequests(roster, [crew, human]);
  assert.deepEqual(queued.pendingHumanRequests, [
    { id: "human", url: human.url, body: human.body, author: "human", threadRootId: "crew", replyToId: "crew" },
  ]);
  assert.equal(queueHumanRequests(queued, [crew, human]), queued);
  const acknowledged = acknowledgeHumanRequests(queued, ["human"]);
  assert.deepEqual(acknowledged.pendingHumanRequests, []);
  assert.deepEqual(acknowledged.handledHumanCommentIds, ["human"]);
  assert.equal(queueHumanRequests(acknowledged, [crew, human]), acknowledged);
});

test("a late reply beneath an earlier root is never skipped", () => {
  const later = {
    id: "later-root",
    url: "https://example.test/root",
    body: "Second human topic",
    author: { login: "human" },
  };
  const first = queueHumanRequests(roster, [crew, human, later]);
  const acknowledged = acknowledgeHumanRequests(first, ["human", "later-root"]);
  const lateReply = {
    id: "late-reply",
    url: "https://example.test/late",
    body: "Follow-up under the first root",
    author: { login: "human" },
    replyToId: "crew",
  };
  const next = queueHumanRequests(acknowledged, [crew, human, lateReply, later]);
  assert.deepEqual(
    next.pendingHumanRequests.map((item) => item.id),
    ["late-reply"],
  );
  assert.equal(next.pendingHumanRequests[0].threadRootId, "crew");
});

test("human inbox bounds pending work, bodies, and handled retention", () => {
  const comments = Array.from({ length: 40 }, (_, i) => ({
    id: `h${i}`,
    url: `https://e/${i}`,
    body: "x".repeat(3000),
    author: { login: "human" },
  }));
  const queued = queueHumanRequests(roster, comments);
  assert.equal(queued.pendingHumanRequests.length, 32);
  assert.match(queued.pendingHumanRequests[0].body, /… \[truncated\]$/);
  assert.ok(queued.pendingHumanRequests[0].body.length < 2100);
  const pending = Array.from({ length: 130 }, (_, i) => ({ id: `p${i}` }));
  const acknowledged = acknowledgeHumanRequests(
    { ...roster, pendingHumanRequests: pending },
    pending.map((item) => item.id),
  );
  assert.equal(acknowledged.handledHumanCommentIds.length, 128);
  assert.equal(acknowledged.handledHumanCommentIds[0], "p2");
});
