import assert from "node:assert/strict";
import test from "node:test";
import { assemblyCardData } from "../../extensions/crew/crew/lib/crew-assembly-card.mjs";

test("assembly card uses each explicit model, then the Crew default, without exposing grants", () => {
  const data = assemblyCardData(
    {
      runId: "run-1",
      agents: [
        { name: "snowball", role: "developer", handle: "developer-snowball-00", tools: ["bash"] },
        { name: "bollo", role: "reviewer", handle: "reviewer-bollo-00", tools: ["read"] },
      ],
    },
    {
      model: "default-model",
      environment: { microvm: "none" },
      members: [
        { name: "snowball", role: "developer", model: "member-model", task: "implement", dependsOn: [] },
        { name: "bollo", role: "reviewer", task: "review", dependsOn: ["developer-snowball-00"] },
      ],
    },
  );
  assert.deepEqual(data, {
    runId: "run-1",
    environment: "none",
    members: [
      {
        specialist: "snowball",
        role: "developer",
        handle: "developer-snowball-00",
        model: "member-model",
        task: "implement",
        dependsOn: [],
      },
      {
        specialist: "bollo",
        role: "reviewer",
        handle: "reviewer-bollo-00",
        model: "default-model",
        task: "review",
        dependsOn: ["developer-snowball-00"],
      },
    ],
  });
  assert.equal(JSON.stringify(data).includes("tools"), false);
});

test("assembly card makes absent task, model, dependencies and environment safe to display", () => {
  const data = assemblyCardData(
    { runId: "run-2", agents: [{ name: "snowball", role: "developer", handle: "developer-snowball-00" }] },
    { members: [{ name: "snowball", role: "developer" }] },
  );
  assert.deepEqual(data.members[0], {
    specialist: "snowball",
    role: "developer",
    handle: "developer-snowball-00",
    model: "default",
    task: "—",
    dependsOn: [],
  });
  assert.equal(data.environment, "auto");
});
