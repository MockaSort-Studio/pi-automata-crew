import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSpecialistRoutes, routeSpecialists } from "../../extensions/crew/crew/lib/specialist-routing.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("review dispatch routes security by changed paths rather than universally", () => {
  const routes = parseSpecialistRoutes(read("../../SPECIALIST_ROUTES"));
  const ordinary = routeSpecialists(["skills/engineering-review/SKILL.md"], routes);
  const security = routeSpecialists(["extensions/crew/crew/lib/member-authority.mjs"], routes);
  assert.ok(!JSON.stringify(ordinary).includes('"bollo"'));
  assert.ok(JSON.stringify(security).includes('"bollo"'));
});

test("review dispatch scaffold requires independent evidence before integration", () => {
  const review = read("../../skills/engineering-review/SKILL.md");
  assert.match(review, /one review crew[\s\S]*several independent reviewers/i);
  assert.match(review, /validate explicit tool grants and evidence access/i);
  assert.match(review, /Hold a blocked member[\s\S]*evidence or\s+a decision/i);
  assert.match(review, /Never merge on a green check alone/i);
});
