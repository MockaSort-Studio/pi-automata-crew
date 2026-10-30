import assert from "node:assert/strict";
import test from "node:test";
import { crewLaunchResultState } from "../../.pi/extensions/hall-crew/crew/lib/crew-launch-view.mjs";

test("successful launch result is hidden because the assembled-Crew card is authoritative", () => {
  assert.equal(crewLaunchResultState(false, { runId: "run-1" }), "hidden");
});

test("launch progress and errors remain visible", () => {
  assert.equal(crewLaunchResultState(true), "launching");
  assert.equal(crewLaunchResultState(false, undefined), "failed");
});
