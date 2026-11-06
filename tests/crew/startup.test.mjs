import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crewPaths, prepareCrew, queuedMessage } from "../../extensions/crew/crew/lib/startup.mjs";
import { assemble } from "../../extensions/crew/crew/lib/assembly.mjs";

const source = readFileSync(new URL("../../extensions/crew/crew/lib/startup.mjs", import.meta.url), "utf8");

test("crew paths include an immutable selected-party manifest", () =>
  assert.deepEqual(crewPaths(".pi", "run-1"), {
    roster: ".pi/runtime/crew-launch/run-1-roster.json",
    selected: ".pi/runtime/crew-launch/selected_crew_run-1.json",
    config: ".pi/runtime/crew-launch/run-1.json",
  }));
test("queued acknowledgment names the SDK runtime", () =>
  assert.match(queuedMessage({ runId: "run-1" }), /SDK runtime/));
test("prepareCrew preserves a selected lead instead of synthesizing one", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      {
        task: "Measure safely",
        members: [
          { name: "old-major", role: "lead" },
          {
            name: "snowball",
            role: "developer",
            tools: [{ suite: "collaboration/pi-github-tools", operations: ["github_issue_view"] }],
          },
        ],
      },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    const selected = JSON.parse(readFileSync(join(cwd, prepared.selectedCrewFile), "utf8"));
    assert.deepEqual(
      config.agents.map((agent) => agent.name),
      ["lead-old-major-00", "developer-snowball-00"],
    );
    assert.deepEqual(config.kickoff, {
      kind: "kickoff",
      phase: "manifest",
      body: "Crew manifest: use the directory for targeted coordination. Await a directed task before beginning work.",
      members: [
        { handle: "lead-old-major-00", role: "lead" },
        { handle: "developer-snowball-00", role: "developer" },
      ],
      plan: [
        { to: "lead-old-major-00", dependsOn: [] },
        { to: "developer-snowball-00", dependsOn: [] },
      ],
      runId: prepared.runId,
      topic: prepared.topic,
    });
    // Sandbox is not decided here: prepareCrew only records the requested
    // environment (default "auto"); launchPreparedCrew resolves it later and
    // threads a concrete `sandbox` into each agent only if Gondolin is
    // actually usable (see tests/crew/environment-startup.test.mjs).
    assert.deepEqual(config.environment, {
      microvm: "auto",
      dependencyCache: "none",
      guestProfile: "gondolin-alpine-node24",
    });
    assert.deepEqual(
      config.agents.map((agent) => agent.sandbox),
      [undefined, undefined],
    );
    assert.equal(selected.members[0].handle, "lead-old-major-00");
    assert.equal(config.agents[1].environmentProfile.format, "hall.crew-profile/v1");
    assert.deepEqual(config.agents[1].suiteGrants, [
      { suite: "collaboration/pi-github-tools", tools: ["github_issue_view"] },
    ]);
    assert.doesNotMatch(config.agents[0].task, /## CREW INPUT/);
    assert.doesNotMatch(source, /assemble\("old-major"/);
    assert.ok(config.agents[0].commTools.includes("comm_notify_all"));
    assert.ok(!config.agents[1].commTools.includes("comm_notify_all"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("prepareCrew preserves validated per-member task and dependsOn in the selected-crew manifest", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      {
        task: "Measure safely",
        members: [
          { name: "old-major", role: "lead", task: "Coordinate the run" },
          {
            name: "snowball",
            role: "developer",
            model: "terra-5.6",
            task: "Build the windmill",
            dependsOn: ["lead-old-major-00"],
          },
        ],
      },
      { cwd },
      ".pi",
    );
    const selected = JSON.parse(readFileSync(join(cwd, prepared.selectedCrewFile), "utf8"));
    assert.equal(selected.members[0].task, "Coordinate the run");
    assert.deepEqual(selected.members[0].dependsOn, []);
    assert.equal(selected.members[1].task, "Build the windmill");
    assert.deepEqual(selected.members[1].dependsOn, ["lead-old-major-00"]);
    assert.equal(selected.members[1].model, "terra-5.6");
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.equal(config.agents[1].model, "terra-5.6");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("prepareCrew gives each worker its explicit model or the Crew model", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      {
        model: "crew-model",
        members: [
          { name: "snowball", role: "developer" },
          { name: "bollo", role: "reviewer", model: "member-model" },
        ],
      },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    const selected = JSON.parse(readFileSync(join(cwd, prepared.selectedCrewFile), "utf8"));
    assert.deepEqual(
      config.agents.map((agent) => agent.model),
      ["crew-model", "member-model"],
    );
    assert.deepEqual(
      selected.members.map((member) => member.model),
      ["crew-model", "member-model"],
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("prepareCrew carries named skill procedures into an isolated worker prompt", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const skill = join(cwd, "skills", "review-probe");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: review-probe\ndescription: test\n---\nSKILL-BODY-MARKER\n");
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      { members: [{ name: "snowball", role: "developer", skills: ["review-probe"] }] },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    const selected = JSON.parse(readFileSync(join(cwd, prepared.selectedCrewFile), "utf8"));
    assert.match(config.agents[0].task, /## REQUIRED SKILLS[\s\S]*SKILL-BODY-MARKER/);
    assert.deepEqual(selected.members[0].skills, ["review-probe"]);
    await assert.rejects(
      prepareCrew(
        { getAllTools: () => [] },
        { members: [{ name: "snowball", role: "developer", skills: ["../escape"] }] },
        { cwd },
        ".pi",
      ),
      /Invalid worker skill name/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("prepareCrew carries reviewer GitHub capability and generic assignment context", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  const githubTools = [
    "github_pull_request_view",
    "github_pull_request_files",
    "github_pull_request_checks",
    "github_pull_request_review_threads",
    "github_pull_request_review_start",
    "github_pull_request_review_inline_comment",
    "github_pull_request_review_submit",
    "github_pull_request_comment",
  ];
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => githubTools },
      {
        members: [
          {
            name: "snowball",
            role: "reviewer",
            task: "Review PR 7.",
            deliverTo: "main",
            authority: { review: "submit", merge: false },
            tools: [{ suite: "collaboration/pi-github-tools", operations: githubTools }],
          },
        ],
      },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.deepEqual(config.agents[0].extensionPaths, []);
    assert.match(config.agents[0].task, /## ASSIGNMENT CONTEXT/);
    assert.deepEqual(config.agents[0].suiteGrants, [{ suite: "collaboration/pi-github-tools", tools: githubTools }]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("prepareCrew rejects a dependsOn reference to an unknown handle", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    await assert.rejects(
      prepareCrew(
        { getAllTools: () => [] },
        {
          task: "Measure safely",
          members: [{ name: "snowball", role: "developer", dependsOn: ["developer-nowhere-00"] }],
        },
        { cwd },
        ".pi",
      ),
      /dependsOn/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("prepareCrew gives a waiting specialist a bounded identity and Crew directory", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      {
        task: "Measure safely",
        members: [{ name: "snowball", role: "developer", task: "Build one bounded windmill plank." }],
      },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    const prompt = config.agents[0].task;
    // Exact substitution point: identity line follows the assembled instructions and
    // precedes the SDK runtime block, matching workerTask()'s fixed template order.
    assert.match(
      prompt,
      /## CREW IDENTITY\nYour exact Comm sender handle is developer-snowball-00\.\n\n## CREW DIRECTORY\n- developer-snowball-00 \(developer\)\n\n## SDK CREW RUNTIME\n/,
    );
    assert.doesNotMatch(prompt, /Build one bounded windmill plank/);
    const fixedOverhead = assemble("snowball", "developer", "").instructions.length;
    assert.ok(prompt.length <= fixedOverhead + 600, "waiting specialist prompt includes only bounded runtime context");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("prepareCrew broadcasts one manifest but gives specialists no direct first-turn delivery", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      { task: "Measure safely", members: [{ name: "snowball", role: "developer" }] },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.equal(config.kickoff.kind, "kickoff");
    assert.equal(config.kickoff.phase, "manifest");
    assert.deepEqual(config.kickoff.plan, [{ to: "developer-snowball-00", dependsOn: [] }]);
    assert.equal(config.agents[0].initialTurn, "first-delivery");
    assert.equal(config.agents[0].delivery, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("no role, including a Lead, starts a turn at launch; every task arrives through dispatch", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      {
        task: "Integrate",
        members: [
          { name: "old-major", role: "lead", task: "Integrate" },
          { name: "snowball", role: "developer", task: "Build" },
        ],
      },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.deepEqual(
      config.agents.map((agent) => [agent.role, agent.initialTurn, agent.delivery]),
      [
        ["lead", "first-delivery", undefined],
        ["developer", "first-delivery", undefined],
      ],
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("prepareCrew rejects model sentinels before a worker can spawn", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    await assert.rejects(
      prepareCrew(
        { getAllTools: () => [] },
        { model: "inherit", members: [{ name: "snowball", role: "developer" }] },
        { cwd },
        ".pi",
      ),
      /Omit model to use Pi's current default/,
    );
    await assert.rejects(
      prepareCrew(
        { getAllTools: () => [] },
        { members: [{ name: "snowball", role: "developer", model: "default" }] },
        { cwd },
        ".pi",
      ),
      /Omit model to use Pi's current default/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("prepareCrew accepts an explicit model id that is in the SDK-visible catalog", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  const ctx = { cwd, modelRegistry: { getAll: () => [{ id: "claude-sonnet-4-5", provider: "anthropic" }] } };
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      { model: "claude-sonnet-4-5", members: [{ name: "snowball", role: "developer" }] },
      ctx,
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.equal(config.agents[0].model, "claude-sonnet-4-5");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("prepareCrew rejects an explicit model id absent from the SDK-visible catalog, before any spawn", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  const ctx = { cwd, modelRegistry: { getAll: () => [{ id: "claude-sonnet-4-5", provider: "anthropic" }] } };
  try {
    await assert.rejects(
      prepareCrew(
        { getAllTools: () => [] },
        { members: [{ name: "snowball", role: "developer", model: "not-a-real-model" }] },
        ctx,
        ".pi",
      ),
      /not found in Pi's available model catalog/,
    );
    // Rejected before anything was created: no roster/launch files were written.
    const { readdirSync, existsSync } = await import("node:fs");
    assert.ok(
      !existsSync(join(cwd, ".pi", "runtime", "crew-launch")) ||
        readdirSync(join(cwd, ".pi", "runtime", "crew-launch")).length === 0,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("prepareCrew treats an omitted model as Pi's current default, with or without a wired catalog", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      { members: [{ name: "snowball", role: "developer" }] },
      { cwd, modelRegistry: { getAll: () => [{ id: "claude-sonnet-4-5", provider: "anthropic" }] } },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.equal(config.agents[0].model, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a Lead cannot depend on other members: it assigns their work and integrates", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    await assert.rejects(
      prepareCrew(
        { getAllTools: () => [] },
        {
          members: [
            { name: "old-major", role: "lead", dependsOn: ["developer-snowball-00"] },
            { name: "snowball", role: "developer" },
          ],
        },
        { cwd },
        ".pi",
      ),
      /Lead .* cannot depend on other members/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
