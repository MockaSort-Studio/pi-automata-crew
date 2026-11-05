import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseSpecialistRoutes,
  routeSpecialists,
  specialistRoutesPath,
} from "../../extensions/crew/crew/lib/specialist-routing.mjs";

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
