import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const skillsDir = new URL("../../.pi/skills/", import.meta.url);
const reviewer = readFileSync(
  new URL("../../.pi/extensions/hall-crew/crew/prompts/roles/reviewer.md", import.meta.url),
  "utf8",
);

// Pi silently drops a skill whose frontmatter is not valid YAML, so parse it as Pi does.
const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

test("at least the reviewer skills exist", () => assert.ok(skills.length >= 3));

for (const { name: directory } of skills) {
  test(`skill ${directory} has loadable frontmatter and is referenced by the reviewer role`, () => {
    const text = readFileSync(new URL(`${directory}/SKILL.md`, skillsDir), "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, "missing frontmatter");
    const { name, description } = parse(frontmatter[1]);
    assert.equal(name, directory);
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(typeof description === "string" && description.length > 20 && description.length <= 1024);
    assert.ok(reviewer.includes(name), `${name} is not loaded by any role`);
  });
}
