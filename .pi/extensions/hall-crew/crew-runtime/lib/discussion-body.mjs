import { createHash } from "node:crypto";

// GitHub Discussion comments are for humans skimming a run, not a transcript
// archive: a multi-kilobyte Crew report pasted verbatim is unusable there.
// Bound it and point back at the originating Comm delivery instead of
// reposting the rest.
export const MAX_DISCUSSION_BODY_CHARS = 4000;

export function truncateForDiscussion(text, max = MAX_DISCUSSION_BODY_CHARS) {
  const body = String(text ?? "");
  if (body.length <= max) return body;
  const omitted = body.length - max;
  return (
    `${body.slice(0, max)}\n\n` +
    `…[truncated ${omitted} more characters. This Discussion comment is a bounded pointer, ` +
    `not the full report — see the originating Crew delivery for the complete content.]`
  );
}

// Short, stable digest of a recipient-scoped message body, used to recognize
// an exact repost (e.g. a specialist resending the same finished report)
// without keeping the content itself around.
export function contentDigest(to, message) {
  return createHash("sha256").update(`${to}\u0000${message}`).digest("hex").slice(0, 24);
}

// One bounded, idempotently-postable comment marking a Crew run's terminal
// rollup on its mirrored Discussion, so a human watching there sees the run
// end even if they never open the Crew monitor. The roster-level status is a
// single terminal value now; per-member PASS/BLOCKED/FAIL detail lives in the
// roster/lifecycle files, not in this comment.
export function closingCommentBody() {
  return `This Crew run is done.\n\nNo further Crew communication will be posted to this Discussion.`;
}

const MAX_RECENT_DIGESTS = 200;

// Bounded, append-biased recency set: remembers the last N posted content
// digests so an identical repost to the same recipient can be recognized and
// skipped, without growing without limit over a long-lived run.
export function withRecentDigest(recentDigests, digest) {
  if (recentDigests.includes(digest)) return recentDigests;
  return [...recentDigests, digest].slice(-MAX_RECENT_DIGESTS);
}
