import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  contextDelta,
  contextSource,
  crewIdentity,
  crewResultSummaryLimit,
  resultBytes,
  summarizeCrewToolResult,
} from "../../.pi/extensions/hall-crew/crew/lib/observability.mjs";

test("Crew artifact identity comes from the durable roster, not prompt content", () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-observability-"));
  const root = join(cwd, ".pi", "runtime", "crew-launch");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "run-roster.json"),
    JSON.stringify({
      runId: "run",
      lead: { name: "lead-old-major", actorId: "lead" },
      resultSummaryMaxBytes: 20480,
      members: [{ name: "architect-tomashco", actorId: "member", role: "architect" }],
    }),
  );
  assert.deepEqual(crewIdentity(cwd, ".pi", "member"), {
    runId: "run",
    actorId: "member",
    rolePersona: "architect-tomashco",
    rosterFile: "run-roster.json",
  });
  assert.equal(crewIdentity(cwd, ".pi", "missing"), null);
  assert.equal(crewResultSummaryLimit(cwd, ".pi", "member"), 20480);
});

test("artifact metrics retain sizes without tool content", () => {
  assert.equal(contextDelta(100, 130), 30);
  assert.equal(contextDelta(undefined, 130), null);
  assert.equal(contextSource([]), "none");
  assert.equal(contextSource(["read"]), "native");
  assert.equal(contextSource(["read", "comm_notify"]), "native");
  assert.equal(
    resultBytes({ content: [{ type: "text", text: "abc" }] }),
    Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: "abc" }], details: undefined })),
  );
});

test("oversized Crew read and shell results become fixed-size metadata", () => {
  const large = {
    toolName: "read",
    content: [{ type: "text", text: "x".repeat(3000) }],
    details: { output: "x".repeat(3000) },
  };
  const summary = summarizeCrewToolResult(large, 512);
  assert.deepEqual(summary.details, {
    crewResultSummary: true,
    tool: "read",
    originalBytes: resultBytes(large),
    limit: 512,
  });
  assert.match(summary.content[0].text, /Content was omitted/);
  assert.equal(summarizeCrewToolResult({ ...large, toolName: "bash" }, 512)?.details.tool, "bash");
  assert.equal(summarizeCrewToolResult({ ...large, toolName: "grep" }, 512), null);
  assert.equal(summarizeCrewToolResult({ ...large, isError: true }, 512), null);
});
