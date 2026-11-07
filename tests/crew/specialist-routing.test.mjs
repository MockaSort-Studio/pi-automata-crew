import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseSpecialistRoutes,
  routeSpecialists,
  specialistRoutesPath,
} from "../../extensions/crew/crew/lib/specialist-routing.mjs";
import { skipWithoutGit } from "../runtime/requires-git.mjs";

const routes = parseSpecialistRoutes(readFileSync(new URL("../../SPECIALIST_ROUTES", import.meta.url), "utf8"));

test("last specialist-route rule selects the sensitive runtime specialists with evidence", () => {
  const result = routeSpecialists(["extensions/crew/crew-runtime/lib/lifecycle-log.mjs"], routes);
  assert.deepEqual(result.specialists, ["tomashco", "bollo"]);
  assert.deepEqual(
    result.matches.map(({ path, rule, specialists }) => [path, rule.pattern, specialists]),
    [["extensions/crew/crew-runtime/lib/lifecycle-log.mjs", "/**/lifecycle-*.mjs", ["tomashco", "bollo"]]],
  );
});

test("routing unions independent paths deterministically and caps the selected party", () => {
  const result = routeSpecialists([".github/workflows/ci.yml", "docs/crew/lifecycle-state-contract.md"], routes, 2);
  assert.deepEqual(result.specialists, ["mergio", "bollo"]);
  assert.deepEqual(
    result.matches.map(({ path, rule }) => [path, rule.pattern]),
    [
      [".github/workflows/ci.yml", "/.github/workflows/**"],
      ["docs/crew/lifecycle-state-contract.md", "/docs/**"],
    ],
  );
});

test("every routed specialist exists in the roster", () => {
  const roster = JSON.parse(
    readFileSync(new URL("../../extensions/crew/crew/agents/roster.json", import.meta.url), "utf8"),
  );
  for (const route of routes)
    for (const specialist of route.specialists) assert.ok(roster.automata[specialist], specialist);
});

test("routing rejects paths outside the repository rather than guessing", () => {
  assert.throws(() => routeSpecialists(["../secrets"], routes), /relative repository path/);
  assert.throws(() => parseSpecialistRoutes("*.mjs @snowball"), /Invalid specialist route/);
});

test("routing policy resolves at the repository root, never under .pi", () => {
  const root = mkdtempSync(join(tmpdir(), "specialist-routes-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "nested", "project"), { recursive: true });
  writeFileSync(join(root, "SPECIALIST_ROUTES"), "/src/** @snowball\n");
  mkdirSync(join(root, ".pi", "crew"), { recursive: true });
  writeFileSync(join(root, ".pi", "crew", "SPECIALIST_ROUTES"), "/src/** @bollo\n");
  assert.equal(specialistRoutesPath(join(root, "nested", "project")), join(root, "SPECIALIST_ROUTES"));
});

test("routing fails clearly when a repository has no root policy", () => {
  const root = mkdtempSync(join(tmpdir(), "specialist-routes-"));
  mkdirSync(join(root, ".git"));
  assert.throws(() => specialistRoutesPath(root), /Repository routing policy is missing/);
});

// The routing file is the only place that decides who works on what, so it must keep up with the repository:
// a path no rule matches sends Main back to guessing personas.
test("every tracked file routes to at least one specialist", (t) => {
  if (skipWithoutGit(t)) return;
  const root = new URL("../../", import.meta.url).pathname;
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !file.startsWith("docs/history/"));
  const unrouted = files.filter((file) => routeSpecialists([file], routes).matches.length === 0);
  assert.deepEqual(unrouted, [], "add a rule to SPECIALIST_ROUTES for these paths");
});

test("every routed specialist exists in the roster, and each owns a domain that fits the area it is routed to", () => {
  const roster = JSON.parse(
    readFileSync(new URL("../../extensions/crew/crew/agents/roster.json", import.meta.url), "utf8"),
  );
  const known = new Set(Object.keys(roster.automata));
  const named = new Set(routes.flatMap((route) => route.specialists));
  assert.deepEqual(
    [...named].filter((name) => !known.has(name)),
    [],
  );
  // Personas whose domains (see the roster) have nothing to do with this repository are never routed.
  for (const stranger of ["hamlet", "pyrate", "aeeeiii", "panoramix"])
    assert.equal(named.has(stranger), false, stranger);
});

test("routing sends current-layout paths to the persona whose domain they belong to", () => {
  const first = (path) => routeSpecialists([path], routes).specialists[0];
  assert.equal(first("extensions/crew/runner/shell-policy.mjs"), "bollo");
  assert.equal(first("extensions/crew/runner/dispatcher.mjs"), "tomashco");
  assert.equal(first("extensions/crew/runner/agent-run.mjs"), "snowball");
  assert.equal(first("extensions/crew/crew/lib/host-monitor.ts"), "frontenzo");
  assert.equal(first("extensions/crew/crew/lib/member-authority.mjs"), "bollo");
  assert.equal(first("tests/runtime/shell-policy.test.mjs"), "bollo");
  assert.equal(first("tests/runtime/crew-battle.test.mjs"), "tomashco");
  assert.equal(first("README.md"), "indiana-docs");
  assert.equal(first("skills/engineering-review/SKILL.md"), "snowball");
});
