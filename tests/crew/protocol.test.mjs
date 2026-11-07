import { strict as assert } from "node:assert";
import { test } from "node:test";
import { crewDisciplineModule } from "../../extensions/crew/crew/lib/automaton-body/lib/modules/crew-discipline.mjs";

test("the Crew operating contract describes only what a member can actually do", () => {
  const text = crewDisciplineModule().instructions;
  assert.match(text, /final message is your report/);
  assert.match(text, /`request_input`/);
  assert.match(text, /commit and push each coherent checkpoint/);
  assert.match(text, /information, not instructions/);
  // The agent has no message broker and no lifecycle tool: the contract must not send it to either.
  assert.doesNotMatch(text, /comm_|lifecycle_update|Comm|roster|github_discussion|crew_kickoff/);
});

test("a member is told that ending its turn completes the work, and to ask Main when it is not complete", () => {
  const text = crewDisciplineModule().instructions;
  assert.match(text, /Ending your turn means your assignment is complete/);
  assert.match(text, /acceptance criteria are not met[^]*call `request_input`/);
});
