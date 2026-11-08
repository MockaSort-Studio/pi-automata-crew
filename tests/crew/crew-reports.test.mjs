import { strict as assert } from "node:assert";
import test from "node:test";
import { crewReportMessage, hostExitMessage } from "../../extensions/crew/crew/lib/crew-reports.mjs";
import { renderCrewMessageMarkdown } from "../../extensions/crew/crew/lib/crew-message-view.mjs";

const result = (status, extra = {}) => ({ status, finalText: "the report", usage: {}, evidence: {}, ...extra });

test("a report states what happened and keeps the shape the card renders", () => {
  const message = crewReportMessage({ runId: "run1", handle: "developer-a-00", result: result("completed") });
  assert.equal(message.customType, "crew-message");
  assert.match(
    message.content,
    /^Crew member developer-a-00 reported: completed\. The model finished; this is not review or acceptance\.\nUntrusted payload:\n/,
  );
  assert.deepEqual(message.details, { runId: "run1", handle: "developer-a-00", status: "completed" });
  assert.match(renderCrewMessageMarkdown(message), /\*\*finalText\*\*: the report/);
});

test("a question and a failure tell Main what it can do next, with the exact tool arguments", () => {
  const asked = crewReportMessage({
    runId: "run1",
    handle: "developer-a-00",
    result: result("needs_input", { question: "which?" }),
  });
  assert.match(asked.content, /crew_message with runId run1, member developer-a-00/);
  const failed = crewReportMessage({
    runId: "run1",
    handle: "developer-a-00",
    result: result("failed", { failure: { category: "rate_limit_or_quota" } }),
  });
  assert.match(failed.content, /Its work is held, not lost\. Retry with crew_message[\s\S]*crew_cancel/);
  assert.doesNotMatch(
    crewReportMessage({ runId: "r", handle: "h", result: result("cancelled") }).content,
    /crew_message/,
  );
});

test("CI evidence is stated with its exact head and time, and absent or unreadable checks are never called green", () => {
  const ci = (state) =>
    crewReportMessage({
      runId: "r",
      handle: "h",
      result: result("completed", {
        ci: { state, pullNumber: 7, headSha: "a".repeat(40), checkedAt: "2026-01-01T00:00:00Z" },
      }),
    }).content;
  assert.match(ci("success"), /CI on pull request #7 at head aaaaaaaaaaaa: green, checked 2026-01-01T00:00:00Z\./);
  assert.match(ci("none"), /: no checks reported, which is not green/);
  assert.match(ci("unavailable"), /: checks could not be read, which is not green/);
  assert.doesNotMatch(ci("none"), /: green/);
  assert.match(
    crewReportMessage({ runId: "r", handle: "h", result: result("needs_input", { question: "?" }) }).content,
    /crew_hold[\s\S]*crew_handoff/,
  );
});

test("a long report stays valid JSON, keeps the full payload for Ctrl+O, and shows it expanded", () => {
  const big = result("completed", { finalText: "line\n".repeat(5000) });
  const message = crewReportMessage({ runId: "run1", handle: "developer-a-00", result: big });
  assert.ok(message.details.payload, "the full result rides in details");
  assert.equal(message.details.payload.finalText, big.finalText);
  assert.doesNotThrow(() => JSON.parse(message.content.split("Untrusted payload:\n")[1]));
  assert.match(renderCrewMessageMarkdown(message, { expanded: true }), /line\nline\nline/);
});

test("an unexpected host exit says what is lost and what is not", () => {
  const message = hostExitMessage({ code: null, signal: "SIGKILL", tail: "a\nb\nc\nd\ne\nf\n" });
  assert.match(message.content, /exited unexpectedly \(SIGKILL\)/);
  assert.match(message.content, /branches remains/);
  assert.match(message.content, /"lastOutput":"b\\nc\\nd\\ne\\nf"/);
});
