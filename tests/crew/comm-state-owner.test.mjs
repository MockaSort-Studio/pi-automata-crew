import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createCommStateOwner } from "../../.pi/extensions/hall-crew/crew/lib/comm-state-owner.mjs";

const members = [
  { handle: "developer-alpha-00", task: "Do alpha work.", dependsOn: [] },
  { handle: "developer-bravo-00", task: "Do bravo work.", dependsOn: ["developer-alpha-00"] },
];
const namespace = "crew-run-1";
const actor = `${namespace}-developer-alpha-00`;

test("registerPlan seeds a typed snapshot from static plan shape", () => {
  const owner = createCommStateOwner();
  owner.registerPlan(namespace, members);
  assert.deepEqual(
    owner.snapshot(namespace).nodes.map((node) => [node.handle, node.status, node.dependsOn, node.task]),
    [
      ["developer-alpha-00", "waiting", [], "Do alpha work."],
      ["developer-bravo-00", "waiting", ["developer-alpha-00"], "Do bravo work."],
    ],
  );
});

test("only typed lifecycle updates advance state and notify subscribers", () => {
  const owner = createCommStateOwner();
  owner.registerPlan(namespace, members);
  const updates = [];
  owner.subscribe(namespace, (update) => updates.push(update));
  assert.deepEqual(owner.update(namespace, actor, "running"), { updated: true });
  assert.deepEqual(owner.update(namespace, actor, "waiting"), { updated: true });
  assert.deepEqual(owner.update(namespace, actor, "running"), { updated: true });
  assert.deepEqual(owner.update(namespace, actor, "complete"), { updated: true });
  const last = updates.at(-1);
  assert.equal(last.find((node) => node.handle === "developer-alpha-00").status, "complete");
  assert.equal(last.find((node) => node.handle === "developer-bravo-00").status, "ready");
});

test("rejects Comm-shaped, unknown, and illegal lifecycle updates", () => {
  const owner = createCommStateOwner();
  owner.registerPlan(namespace, members);
  assert.deepEqual(owner.update(namespace, actor, "report"), { updated: false });
  assert.deepEqual(owner.update(namespace, "stranger", "running"), { updated: false });
  assert.deepEqual(owner.update(namespace, actor, "complete"), { updated: false });
});

test("registerPlan is idempotent and release removes a run", () => {
  const owner = createCommStateOwner();
  assert.deepEqual(owner.registerPlan(namespace, members), { registered: true });
  assert.deepEqual(owner.registerPlan(namespace, []), { registered: false });
  owner.release(namespace);
  assert.equal(owner.snapshot(namespace), undefined);
  assert.doesNotThrow(() => owner.subscribe(namespace, () => {})());
});
