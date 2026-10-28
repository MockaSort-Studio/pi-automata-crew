import { strict as assert } from "node:assert";
import test from "node:test";
import { installCrewDispatchArming, isCrewDispatchRequest } from "../../.pi/extensions/hall-crew/crew/lib/dispatch-arming.mjs";

test("dispatch detection is bounded to an explicit dispatch token", () => {
  assert.equal(isCrewDispatchRequest("dispatch"), true);
  assert.equal(isCrewDispatchRequest("please dispatch the crew"), true);
  assert.equal(isCrewDispatchRequest("redispatch the build"), false);
  assert.equal(isCrewDispatchRequest("describe dispatching"), false);
});

test("dispatch arming injects the manifest-kickoff and explicit-task protocol", () => {
  let input;
  installCrewDispatchArming({ on: (name, handler) => name === "input" && (input = handler) });
  const armed = input({ source: "interactive", text: "dispatch" });
  assert.equal(armed.action, "transform");
  assert.match(armed.text, /start_crew/);
  assert.match(armed.text, /non-turn-triggering/);
  assert.match(armed.text, /does not assign specialist work/);
  assert.match(armed.text, /Crew TUI and lifecycle own worker progress/);
  assert.deepEqual(input({ source: "extension", text: "dispatch" }), { action: "continue" });
});
