const MAX_BODY = 2000;
const MAX_PENDING = 32;
const MAX_HANDLED = 128;
const MAX_SEEN = 2048;

function isCrewComment(roster, comment) {
  const members = [roster.lead, ...(roster.members || [])].filter(Boolean);
  return members.some((member) => comment.body?.includes(`\n---\n@${member.name}\n`));
}

const request = (comment) => ({
  id: comment.id,
  url: String(comment.url || "").slice(0, 500),
  body:
    String(comment.body || "").length > MAX_BODY
      ? `${String(comment.body).slice(0, MAX_BODY)}… [truncated]`
      : String(comment.body || ""),
  author: comment.author?.login ?? "unknown",
  threadRootId: comment.replyToId || comment.id,
  ...(comment.replyToId ? { replyToId: comment.replyToId } : {}),
});

export function queueHumanRequests(roster, comments) {
  const pending = roster.pendingHumanRequests || [];
  const seen = new Set(roster.humanInboxSeenIds || []);
  const known = new Set([...(roster.handledHumanCommentIds || []), ...pending.map((item) => item.id)]);
  const additions = [];
  for (const comment of comments) {
    if (!seen.has(comment.id) && !known.has(comment.id) && !isCrewComment(roster, comment)) {
      if (pending.length + additions.length >= MAX_PENDING) break;
      additions.push(request(comment));
      known.add(comment.id);
    }
    seen.add(comment.id);
  }
  const seenIds = [...seen].slice(-MAX_SEEN);
  const previous = roster.humanInboxSeenIds || [];
  if (!additions.length && seenIds.at(-1) === previous.at(-1) && seenIds.length === previous.length) return roster;
  return { ...roster, pendingHumanRequests: [...pending, ...additions], humanInboxSeenIds: seenIds };
}

export function acknowledgeHumanRequests(roster, ids) {
  const selected = new Set(ids);
  const pending = roster.pendingHumanRequests || [];
  const missing = ids.filter((id) => !pending.some((item) => item.id === id));
  if (missing.length) throw new Error(`Human request is not pending: ${missing.join(", ")}`);
  const handled = [...new Set([...(roster.handledHumanCommentIds || []), ...ids])].slice(-MAX_HANDLED);
  // Handled ids stay in the wider seen set so eviction from handled history cannot requeue them.
  const seen = [...new Set([...(roster.humanInboxSeenIds || []), ...ids])].slice(-MAX_SEEN);
  return {
    ...roster,
    pendingHumanRequests: pending.filter((item) => !selected.has(item.id)),
    handledHumanCommentIds: handled,
    humanInboxSeenIds: seen,
  };
}
