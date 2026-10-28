import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  renderBroadcast,
  renderDirected,
  renderFinal,
  renderFinding,
  renderKickoff,
  renderReply,
  renderReview,
} from "../../.pi/extensions/hall-crew/crew/lib/discussion-templates.mjs";

const roster = {
  runId: "run-1",
  topic: "crew.run-1",
  outputPath: "docs/result.md",
  lead: { name: "lead-old-major" },
};
const input = {
  title: "Audit Crew communication",
  objective: "Identify protocol gaps and recommend bounded fixes.",
  acceptanceCriteria: ["Map the current path.", "Name verified gaps."],
  crew: [
    { name: "architect-tomashco", assignment: "Review protocol boundaries.", acceptanceCriteria: ["Map boundaries."] },
    {
      name: "advisor-indiana-docs",
      assignment: "Verify behavior.",
      acceptanceCriteria: ["Name verified gaps."],
      dependsOn: ["architect-tomashco"],
    },
  ],
  references: [{ label: "Protocol", url: "https://example.test/protocol" }],
  openQuestions: ["Should retries remain bounded?"],
};

test("kickoff renders one concise canonical structure", () => {
  assert.equal(
    renderKickoff(roster, input),
    `## HALL/KICKOFF v1
GOAL: Identify protocol gaps and recommend bounded fixes.
SUCCESS:
- [ ] Map the current path.
- [ ] Name verified gaps.

=== ASSIGNMENT @architect-tomashco ===
TASK: Review protocol boundaries.
DONE:
- [ ] Map boundaries.

=== ASSIGNMENT @advisor-indiana-docs ===
TASK: Verify behavior.
DONE:
- [ ] Name verified gaps.

## References
- [Protocol](https://example.test/protocol)

## Open questions
- Should retries remain bounded?

## HALL/SCRATCHPAD`,
  );
});

test("kickoff rejects repeated links instead of rendering duplicates", () => {
  assert.throws(
    () =>
      renderKickoff(roster, {
        ...input,
        objective: "Read https://example.test/protocol before starting.",
      }),
    /repeated link/,
  );
});

test("kickoff rejects missing criteria, specialists, and malformed handles", () => {
  assert.throws(() => renderKickoff(roster, { ...input, acceptanceCriteria: [] }), /acceptance criterion/);
  assert.throws(() => renderKickoff(roster, { ...input, crew: [] }), /at least one specialist/);
  assert.throws(
    () =>
      renderKickoff(roster, {
        ...input,
        crew: [{ name: "Tomashco", assignment: "Review." }],
      }),
    /role-persona handle/,
  );
});

test("directed, broadcast, and reply templates use canonical addressees without transport tags", () => {
  assert.equal(
    renderDirected("architect-tomashco", "Check the ownership boundary."),
    "@architect-tomashco\n\nCheck the ownership boundary.",
  );
  assert.equal(renderBroadcast("Use the resident supervisor."), "@all\n\nUse the resident supervisor.");
  assert.equal(
    renderReply("lead-old-major", "The boundary is verified."),
    "@lead-old-major\n\nThe boundary is verified.",
  );
  assert.throws(() => renderBroadcast("[Broadcast] Use the supervisor."), /transport label/);
  assert.throws(() => renderDirected("architect", "Check this boundary."), /role-persona handle/);
});

test("finding and review templates contain only semantic headings", () => {
  assert.equal(
    renderFinding({ subject: "Actor ownership", message: "The resident host owns nested actors." }),
    "## Finding: Actor ownership\n\nThe resident host owns nested actors.",
  );
  assert.equal(
    renderReview({ subject: "Actor ownership", decision: "ACCEPT", reason: "The source and probe agree." }),
    "## Review: Actor ownership\n\n**Decision:** ACCEPT\n\nThe source and probe agree.",
  );
});

test("final template records criterion evidence and named gaps", () => {
  const rendered = renderFinal({
    summary: "The communication contract is verified.",
    acceptance: [{ criterion: "Replies are threaded.", evidenceUrl: "https://example.test/reply" }],
    gaps: ["Project state remains deferred."],
  });
  assert.match(rendered, /^## Final acceptance/);
  assert.match(rendered, /- \[x\] Replies are threaded/);
  assert.match(rendered, /### Remaining gaps/);
});
test("Discussion templates reject context-bloating payloads", () => {
  assert.throws(() => renderFinding({ subject: "Oversized", message: "x".repeat(6001) }), /exceeds 6000/);
  assert.throws(
    () => renderKickoff(roster, { ...input, acceptanceCriteria: Array(21).fill("Criterion") }),
    /exceeds 20/,
  );
  assert.throws(
    () =>
      renderKickoff(roster, {
        ...input,
        crew: Array.from({ length: 9 }, (_, i) => ({ name: `advisor-peer${i}`, assignment: "Review." })),
      }),
    /exceeds 8/,
  );
  assert.throws(
    () =>
      renderFinding({
        subject: "Evidence",
        message: "Bounded evidence.",
        evidence: Array.from({ length: 13 }, (_, i) => ({ label: `E${i}`, url: `https://e.test/${i}` })),
      }),
    /exceeds 12/,
  );
});
