import { boundedPayload } from "./bounded-payload.mjs";

const HINTS = {
  needs_input: (runId, handle) =>
    ` It is waiting for your answer: call crew_message with runId ${runId}, member ${handle} and your reply. To acknowledge it without a new turn, use crew_hold; to end it without accepting its work, crew_handoff.`,
  failed: (runId, handle) =>
    ` Its work is held, not lost. Retry with crew_message (runId ${runId}, member ${handle}), hold it with crew_hold, hand it off with crew_handoff, or end it with crew_cancel.`,
  completed: () => " The model finished; this is not review or acceptance.",
};
const CI = {
  success: "green",
  failure: "red",
  none: "no checks reported, which is not green",
  unavailable: "checks could not be read, which is not green",
  closed: "pull request closed",
};

// The CI evidence a report carries, stated with its exact head and time so it is never read as more than it is.
function ciLine(ci) {
  if (!ci?.state) return "";
  const pr = ci.pullNumber ? ` on pull request #${ci.pullNumber}` : "";
  const head = ci.headSha ? ` at head ${String(ci.headSha).slice(0, 12)}` : "";
  const at = ci.checkedAt ? `, checked ${ci.checkedAt}` : "";
  return `\nCI${pr}${head}: ${CI[ci.state] ?? ci.state}${at}.`;
}

// A member's result as a Main session message. The payload keeps the "Untrusted payload:" shape so the
// existing card renders it (and Ctrl+O expands a shortened one); the text states what Main can do next.
export function crewReportMessage({ runId, handle, result }) {
  const { text, shortened } = boundedPayload(result);
  const hint = HINTS[result.status]?.(runId, handle) ?? "";
  return {
    customType: "crew-message",
    content: `Crew member ${handle} reported: ${result.status}.${hint}${ciLine(result.ci)}\nUntrusted payload:\n${text}`,
    display: true,
    details: { runId, handle, status: result.status, ...(shortened ? { payload: result } : {}) },
  };
}

// The result still reaches Main when it cannot be formatted: a report must never be lost, or take Main down,
// because of how it is rendered.
export function plainReportMessage({ runId, handle, result }, error) {
  const status = typeof result?.status === "string" ? result.status : "unknown";
  return {
    customType: "crew-message",
    content: `Crew member ${handle} reported: ${status}. The full report could not be formatted (${String(error?.message ?? error).slice(0, 120)}); it is in the run record under runId ${runId}.`,
    display: true,
    details: { runId, handle, status },
  };
}

export const hostExitMessage = ({ code, signal, tail }) => ({
  customType: "crew-message",
  content: `The crew host exited unexpectedly (${signal ?? `code ${code}`}). Running crews are gone; anything members pushed or salvaged to their branches remains. Start the crew again to continue.\nUntrusted payload:\n${JSON.stringify(
    {
      lastOutput: String(tail ?? "")
        .trim()
        .split("\n")
        .slice(-5)
        .join("\n"),
    },
  )}`,
  display: true,
  details: { status: "host_exited" },
});
