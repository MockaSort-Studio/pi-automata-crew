import { boundedPayload } from "./bounded-payload.mjs";

const HINTS = {
  needs_input: (runId, handle) =>
    ` It is waiting for your answer: call crew_message with runId ${runId}, member ${handle} and your reply.`,
  failed: (runId, handle) =>
    ` Its work is held, not lost. Retry with crew_message (runId ${runId}, member ${handle}) or end it with crew_cancel.`,
};

// A member's result as a Main session message. The payload keeps the "Untrusted payload:" shape so the
// existing card renders it (and Ctrl+O expands a shortened one); the text states what Main can do next.
export function crewReportMessage({ runId, handle, result }) {
  const { text, shortened } = boundedPayload(result);
  const hint = HINTS[result.status]?.(runId, handle) ?? "";
  return {
    customType: "crew-message",
    content: `Crew member ${handle} reported: ${result.status}.${hint}\nUntrusted payload:\n${text}`,
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
