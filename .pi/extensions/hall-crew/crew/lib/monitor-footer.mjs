import { formatTokenCount } from "./monitor-snapshot.mjs";

// Pure compact status-footer renderer over a CrewMonitorSnapshot.
// One line, no cost/money figures, no queue/inflight abbreviations: just
// automaton counts by durable lifecycle bucket and total generated output.
const BUCKET_LABELS = Object.freeze([
  ["running", "running"],
  ["waiting", "waiting"],
  ["queued", "queued"],
  ["attention", "needs attention"],
  ["complete", "complete"],
  ["blocked", "blocked"],
  ["failed", "failed"],
]);

export function renderCrewStatusFooter(snapshot) {
  if (!snapshot) return "";
  const { runId, counts, totalGeneratedOutputTokens } = snapshot;
  const total = counts?.total ?? 0;

  const parts = [`Crew ${runId} · ${total} automata`];
  for (const [key, label] of BUCKET_LABELS) {
    const count = counts?.[key] ?? 0;
    if (count > 0) parts.push(`${count} ${label}`);
  }
  const tokens = Number.isFinite(totalGeneratedOutputTokens) ? totalGeneratedOutputTokens : 0;
  parts.push(`${formatTokenCount(tokens)} output tokens`);

  return parts.join(" · ");
}
