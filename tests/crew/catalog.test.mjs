import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AUTOMATA, rankAutomata } from "../../.pi/extensions/hall-crew/crew/lib/roster.mjs";
test("catalog has compact routing discriminants", () => {
  assert.deepEqual(AUTOMATA.hamlet.domains, ["c++", "real-time-systems", "embedded", "build-systems"]);
  assert.deepEqual(AUTOMATA.panoramix.domains, ["elixir", "erlang", "beam", "phoenix"]);
  assert.ok(AUTOMATA["old-major"].domains.includes("planning"));
  assert.ok(AUTOMATA.tomashco.domains.includes("backend"));
});
test("routing ranks matching automata deterministically", () => {
  assert.equal(rankAutomata("debug an Elixir Phoenix application")[0].actor.name, "panoramix");
  assert.equal(rankAutomata("plan backend API events")[0].actor.name, "tomashco");
});
