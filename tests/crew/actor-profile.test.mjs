import { strict as assert } from "node:assert";
import test from "node:test";
import { compileActorProfile } from "../../.pi/extensions/hall-crew/crew/lib/actor-profile.mjs";

test("actor profile derives a suite projection from granted operation names", () => {
  const profile = compileActorProfile({
    tools: ["read", "github_issue_view", "github_pull_request_view"],
    commTools: ["comm_notify"],
    suites: [
      {
        suite: "collaboration/pi-github-tools",
        tools: ["github_issue_view", "github_pull_request_view"],
      },
    ],
  });
  assert.deepEqual(profile, {
    format: "hall.crew-profile/v1",
    tools: ["read", "github_issue_view", "github_pull_request_view"],
    commTools: ["comm_notify"],
    builtins: ["read"],
    suites: [
      {
        suite: "collaboration/pi-github-tools",
        tools: ["github_issue_view", "github_pull_request_view"],
      },
    ],
  });
});

test("actor profile rejects an ambiguous Armory operation", () =>
  assert.throws(
    () =>
      compileActorProfile({
        tools: ["tool"],
        suites: [
          { suite: "one", tools: ["tool"] },
          { suite: "two", tools: ["tool"] },
        ],
      }),
    /multiple Armory suites/,
  ));
