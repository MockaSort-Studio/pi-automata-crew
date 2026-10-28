import { strict as assert } from "node:assert";
import { test } from "node:test";
import { crewDisciplineModule } from "../../.pi/extensions/hall-crew/crew/lib/automaton-body/lib/modules/crew-discipline.mjs";
test("base Crew discipline is Comm-only", () => {
  const text = crewDisciplineModule().instructions;
  assert.match(text, /comm_request/);
  assert.match(text, /Only Main\/Lifecycle removes SDK workers/);
  assert.doesNotMatch(text, /github_discussion|crew_kickoff/);
});
