import { strict as assert } from "node:assert";
import test from "node:test";
import {
  MAX_DISCUSSION_BODY_CHARS,
  closingCommentBody,
  contentDigest,
  truncateForDiscussion,
  withRecentDigest,
} from "../../.pi/extensions/hall-crew/crew-runtime/lib/discussion-body.mjs";

test("truncateForDiscussion passes short text through unchanged", () => {
  assert.equal(truncateForDiscussion("short report"), "short report");
});

test("truncateForDiscussion bounds long text with a pointer to the full report", () => {
  const long = "x".repeat(MAX_DISCUSSION_BODY_CHARS + 500);
  const truncated = truncateForDiscussion(long);
  assert.ok(truncated.length < long.length);
  assert.ok(truncated.startsWith("x".repeat(MAX_DISCUSSION_BODY_CHARS)));
  assert.match(truncated, /truncated 500 more characters/);
  assert.match(truncated, /full report/);
});

test("contentDigest is stable for identical (to, message) pairs and differs otherwise", () => {
  const a = contentDigest("architect-hamlet-00", "Report body.");
  const b = contentDigest("architect-hamlet-00", "Report body.");
  const c = contentDigest("architect-hamlet-00", "Different report.");
  const d = contentDigest("other-recipient", "Report body.");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test("closingCommentBody names the run as done", () => {
  assert.match(closingCommentBody(), /This Crew run is done\./);
});

test("withRecentDigest is append-only, de-duplicating, and bounded", () => {
  let digests = [];
  digests = withRecentDigest(digests, "d1");
  digests = withRecentDigest(digests, "d1");
  assert.deepEqual(digests, ["d1"]);
  for (let i = 0; i < 250; i++) digests = withRecentDigest(digests, `d${i}`);
  assert.ok(digests.length <= 200);
  assert.ok(digests.includes("d249"));
});
