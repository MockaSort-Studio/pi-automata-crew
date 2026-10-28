import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  STATES,
  TERMINAL_OUTCOMES,
  isTerminal,
  canTransition,
  transition,
  createLifecycle,
} from "../../.pi/extensions/hall-crew/crew/lib/lifecycle-state.mjs";

test("STATES and TERMINAL_OUTCOMES expose the durable contract vocabulary", () => {
  assert.deepEqual(STATES, ["queued", "running", "attention"]);
  assert.deepEqual(TERMINAL_OUTCOMES, ["PASS", "BLOCKED", "FAIL"]);
});

test("isTerminal is true only for PASS, BLOCKED, FAIL", () => {
  for (const outcome of TERMINAL_OUTCOMES) assert.equal(isTerminal(outcome), true);
  for (const state of STATES) assert.equal(isTerminal(state), false);
});

test("canTransition allows the documented legal edges", () => {
  assert.equal(canTransition("queued", "running"), true);
  assert.equal(canTransition("queued", "FAIL"), true);
  assert.equal(canTransition("running", "attention"), true);
  assert.equal(canTransition("running", "PASS"), true);
  assert.equal(canTransition("running", "FAIL"), true);
  assert.equal(canTransition("attention", "running"), true);
  assert.equal(canTransition("attention", "BLOCKED"), true);
  assert.equal(canTransition("attention", "FAIL"), true);
});

test("canTransition rejects edges that skip or reverse the contract", () => {
  assert.equal(canTransition("queued", "attention"), false);
  assert.equal(canTransition("queued", "PASS"), false);
  assert.equal(canTransition("running", "BLOCKED"), false);
  assert.equal(canTransition("attention", "PASS"), false);
});

test("canTransition rejects every edge out of a terminal outcome", () => {
  for (const outcome of TERMINAL_OUTCOMES) {
    for (const to of [...STATES, ...TERMINAL_OUTCOMES]) {
      assert.equal(canTransition(outcome, to), false, `${outcome} -> ${to} must be illegal`);
    }
  }
});

test("transition returns the destination on a legal edge", () => {
  assert.equal(transition("queued", "running"), "running");
  assert.equal(transition("running", "PASS"), "PASS");
});

test("transition throws a descriptive error on an illegal edge", () => {
  assert.throws(() => transition("queued", "PASS"), /Illegal Crew lifecycle transition: queued -> PASS/);
  assert.throws(() => transition("PASS", "running"), /Illegal Crew lifecycle transition: PASS -> running/);
});

test("createLifecycle starts queued, records history, and terminalizes once", () => {
  const lifecycle = createLifecycle();
  assert.equal(lifecycle.state, "queued");
  assert.deepEqual(lifecycle.history, ["queued"]);
  assert.equal(lifecycle.isTerminal(), false);

  lifecycle.transition("running");
  lifecycle.transition("attention");
  lifecycle.transition("running");
  lifecycle.transition("FAIL");

  assert.equal(lifecycle.state, "FAIL");
  assert.deepEqual(lifecycle.history, ["queued", "running", "attention", "running", "FAIL"]);
  assert.equal(lifecycle.isTerminal(), true);
  assert.throws(() => lifecycle.transition("running"), /Illegal Crew lifecycle transition: FAIL -> running/);
});

test("createLifecycle rejects a non-durable initial state", () => {
  assert.throws(() => createLifecycle("bogus"), /Unknown Crew lifecycle state: bogus/);
});
