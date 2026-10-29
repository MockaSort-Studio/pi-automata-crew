import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const skillsDir = new URL("../../.pi/skills/", import.meta.url);
// A skill that nothing references is never armed: the reviewer role or AGENTS.md must name it.
const referencedBy = ["../../.pi/extensions/hall-crew/crew/prompts/roles/reviewer.md", "../../AGENTS.md"]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

// Pi silently drops a skill whose frontmatter is not valid YAML, so parse it as Pi does.
const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

test("at least the reviewer skills exist", () => assert.ok(skills.length >= 3));

for (const { name: directory } of skills) {
  test(`skill ${directory} has loadable frontmatter and is referenced`, () => {
    const text = readFileSync(new URL(`${directory}/SKILL.md`, skillsDir), "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, "missing frontmatter");
    const { name, description } = parse(frontmatter[1]);
    assert.equal(name, directory);
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(typeof description === "string" && description.length > 20 && description.length <= 1024);
    assert.ok(referencedBy.includes(name), `${name} is not referenced by the reviewer role or AGENTS.md`);
  });
}

test("AGENTS.md stays short, because Pi sends it with every request, and arms the Crew skills", () => {
  const agents = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.ok(agents.split("\n").length <= 40, "AGENTS.md is part of every prompt; keep it concise");
  for (const skill of ["engineering-execution", "engineering-review"]) assert.match(agents, new RegExp(skill));
});
