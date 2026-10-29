import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const skillPath = new URL("../../.pi/skills/independent-runtime-review/SKILL.md", import.meta.url);
const reviewerPath = new URL("../../.pi/extensions/hall-crew/crew/prompts/roles/reviewer.md", import.meta.url);
const securitySkillPath = new URL("../../.pi/skills/security-boundary-review/SKILL.md", import.meta.url);

test("the reviewer role invokes the project independent-runtime-review skill", () => {
  const skill = readFileSync(skillPath, "utf8");
  const reviewer = readFileSync(reviewerPath, "utf8");
  const securitySkill = readFileSync(securitySkillPath, "utf8");
  assert.match(skill, /^---\nname: independent-runtime-review\ndescription: .+\n/m);
  assert.match(skill, /worker launch failure/);
  assert.match(skill, /network, credential/);
  assert.match(skill, /would regress/);
  assert.match(reviewer, /independent-runtime-review/);
  assert.match(reviewer, /security-boundary-review/);
  assert.match(securitySkill, /^---\nname: security-boundary-review\ndescription: .+\n/m);
  assert.match(securitySkill, /deny-by-default/);
  assert.match(securitySkill, /credential cannot broaden/);
});
