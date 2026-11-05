import assert from "node:assert/strict";
import test from "node:test";
import { skillFromCommand, skillFromRead } from "../../extensions/crew/crew/lib/skill-trace.mjs";

test("reading a SKILL.md is skill use, named by its directory", () => {
  assert.equal(skillFromRead("read", { path: "/repo/skills/engineering-review/SKILL.md" }), "engineering-review");
  assert.equal(skillFromRead("read", { path: "skills/post-iteration-review/SKILL.md" }), "post-iteration-review");
  assert.equal(skillFromRead("read", { path: "C:\\skills\\crew\\SKILL.md" }), "crew");
});

test("other reads and other tools are not skill use", () => {
  assert.equal(skillFromRead("read", { path: "/repo/README.md" }), undefined);
  assert.equal(skillFromRead("read", { path: "/repo/skills/x/SKILL.md.bak" }), undefined);
  assert.equal(skillFromRead("read", { path: "SKILL.md" }), undefined);
  assert.equal(skillFromRead("bash", { path: "/repo/skills/x/SKILL.md" }), undefined);
  assert.equal(skillFromRead("read", undefined), undefined);
});

test("only a leading /skill:<name> command counts, with or without arguments", () => {
  assert.equal(skillFromCommand("/skill:engineering-execution"), "engineering-execution");
  assert.equal(skillFromCommand("/skill:engineering-review fix the lifecycle log"), "engineering-review");
  assert.equal(skillFromCommand("please run /skill:engineering-review"), undefined);
  assert.equal(skillFromCommand("/skills list"), undefined);
  assert.equal(skillFromCommand("/skill:Bad_Name"), undefined);
  assert.equal(skillFromCommand(undefined), undefined);
});
