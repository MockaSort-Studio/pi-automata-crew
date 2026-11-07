import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requiredWorkerSkills } from "../../extensions/crew/crew/lib/worker-skills.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("engineering review describes independent specialist dispatch", () => {
  const review = read("../../skills/engineering-review/SKILL.md");
  for (const phrase of [
    "git diff",
    "crew_route",
    "SPECIALIST_ROUTES",
    "never select the author",
    "read grep find ls bash",
    "start_crew",
    "parallel",
    "without polling",
    "one verdict per reviewer",
    "fixes go back",
  ])
    assert.ok(review.includes(phrase), phrase);
});

test("engineering review separates dispatch from a no-git reviewer procedure", () => {
  const review = read("../../skills/engineering-review/SKILL.md");
  const parts = review.split("## Reviewing (you are the reviewer)");
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes("## Dispatching reviewers (Main)"));
  for (const phrase of [
    "without git",
    "github_pull_request_files",
    "github_pull_request_view",
    "files named in the assignment",
    "node",
    "missing tools",
  ])
    assert.ok(parts[1].includes(phrase), phrase);
});

test("reviewer guidance and worker embedding use the standalone catalog", () => {
  const review = read("../../skills/engineering-review/SKILL.md");
  const reviewer = read("../../extensions/crew/crew/prompts/roles/reviewer.md");
  const iteration = read("../../skills/post-iteration-review/SKILL.md");
  const security = read("../../skills/security-boundary-review/SKILL.md");
  for (const phrase of ["worker launch failure", "network, credential", "would regress"])
    assert.ok(review.includes(phrase));
  for (const name of ["engineering-review", "post-iteration-review", "security-boundary-review"]) {
    assert.ok(reviewer.includes(name));
    const embedded = requiredWorkerSkills(process.cwd(), [name]);
    assert.deepEqual(embedded.names, [name]);
    assert.ok(embedded.text.includes(read(`../../skills/${name}/SKILL.md`)));
  }
  for (const section of ["Over-engineering", "Dead code and tests", "Weak spots", "Vulnerabilities"])
    assert.ok(iteration.includes(section));
  assert.match(iteration, /deny-by-default/);
  assert.match(security, /deny-by-default/);
  assert.match(security, /credential cannot broaden/);
  assert.doesNotMatch(security, /Bollo/i);
});
