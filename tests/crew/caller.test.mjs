import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertActorOwnsSender } from "../../.pi/extensions/hall-crew/crew/lib/caller.mjs";

const roster = {
  lead: { name: "lead-old-major", actorId: "lead-1" },
  members: [{ name: "advisor-snowball", actorId: "advisor-1" }],
};

test("SDK actor provenance binds Crew sender identity when available", () => {
  assert.doesNotThrow(() => assertActorOwnsSender(roster, "lead-old-major", { PI_SDK_ACTOR_ID: "lead-1" }));
  assert.doesNotThrow(() => assertActorOwnsSender(roster, "advisor-snowball", { PI_SDK_ACTOR_ID: "advisor-1" }));
  assert.throws(
    () => assertActorOwnsSender(roster, "lead-old-major", { PI_SDK_ACTOR_ID: "advisor-1" }),
    /does not match/,
  );
  assert.doesNotThrow(() => assertActorOwnsSender(roster, "lead-old-major", {}));
});
