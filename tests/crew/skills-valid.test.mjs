import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const skillsDir = new URL("../../skills/", import.meta.url);
const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
const names = skills.map(({ name }) => name);

test("the project skill catalog contains the supported standalone procedures", () => {
  assert.deepEqual(names.sort(), [
    "engineering-execution",
    "engineering-review",
    "post-iteration-review",
    "security-boundary-review",
  ]);
});

for (const { name: directory } of skills) {
  test(`skill ${directory} has valid frontmatter and no skill dependency`, () => {
    const text = readFileSync(new URL(`${directory}/SKILL.md`, skillsDir), "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, "missing frontmatter");
    const metadata = parse(frontmatter[1]);
    assert.deepEqual(Object.keys(metadata).sort(), ["description", "name"]);
    assert.equal(metadata.name, directory);
    assert.match(metadata.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(
      typeof metadata.description === "string" &&
        metadata.description.length > 20 &&
        metadata.description.length <= 1024,
    );
    for (const other of names.filter((name) => name !== directory))
      assert.ok(!text.includes(other), `${directory} references ${other}`);
  });
}

test("AGENTS.md stays short and names the main Crew skills", () => {
  const agents = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");
  assert.ok(agents.split("\n").length <= 40);
  for (const skill of ["engineering-execution", "engineering-review"]) assert.match(agents, new RegExp(skill));
});
