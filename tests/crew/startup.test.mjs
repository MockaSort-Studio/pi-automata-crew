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
test("launch acknowledgment names the run and tells Main to wait for the reports", () => {
  const message = queuedMessage({ runId: "run-1" });
  assert.match(message, /Crew run-1 launched/);
  assert.match(message, /end your turn and wait/);
});
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

test("prepareCrew rejects skill injection and never loads skill files into worker prompts", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const skill = join(cwd, "skills", "review-probe");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: review-probe\ndescription: test\n---\nSKILL-BODY-MARKER\n");
    let preparedWithSkill;
    let rejection;
    try {
      preparedWithSkill = await prepareCrew(
        { getAllTools: () => [] },
        { members: [{ name: "snowball", role: "developer", skills: ["review-probe"] }] },
        { cwd },
        ".pi",
      );
    } catch (error) {
      rejection = error;
    }
    // Restoring the old loader would return a worker prompt containing this selected skill's marker.
    if (preparedWithSkill) assert.doesNotMatch(preparedWithSkill.agents[0].task, /SKILL-BODY-MARKER/);
    assert.match(String(rejection), /skills.*not supported/i);
    const prepared = await prepareCrew(
      { getAllTools: () => [] },
      { members: [{ name: "snowball", role: "developer" }] },
      { cwd },
      ".pi",
    );
    const config = JSON.parse(readFileSync(join(cwd, prepared.configFile), "utf8"));
    assert.doesNotMatch(config.agents[0].task, /SKILL-BODY-MARKER/);
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
    // The member is told its handle, run and directory, and nothing about brokers or lifecycle tools.
    assert.match(
      prompt,
      /## CREW\nYour handle is developer-snowball-00\.\nRUN: [0-9a-f-]{36}\nTOPIC: crew\.[0-9a-f-]{36}\n\n## CREW DIRECTORY\n- developer-snowball-00 \(developer\)$/,
    );
    assert.doesNotMatch(prompt, /Comm sender|SDK CREW RUNTIME|roster state/);
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

test("deliverTo must be main or a member of the crew, rejected before anything is written", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "crew-sdk-"));
  try {
    const members = (deliverTo) => [
      { name: "snowball", role: "developer", deliverTo },
      { name: "bollo", role: "reviewer" },
    ];
    await assert.rejects(
      prepareCrew({ getAllTools: () => [] }, { members: members("lead") }, { cwd }, ".pi"),
      /deliverTo "lead", which is neither "main" nor a member/,
    );
    for (const ok of ["main", "bollo", "reviewer-bollo-00", undefined])
      await prepareCrew({ getAllTools: () => [] }, { members: members(ok) }, { cwd }, ".pi");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
