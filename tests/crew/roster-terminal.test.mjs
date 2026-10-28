import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  terminalizeRoster,
  terminalizeRostersForRemovedActors,
} from "../../.pi/extensions/hall-crew/crew/lib/roster-terminal.mjs";

test("terminalizeRoster marks a non-terminal roster done and clears members", () => {
  const roster = { runId: "run-1", status: "started", members: [{ name: "snowball" }] };
  assert.deepEqual(terminalizeRoster(roster), { runId: "run-1", status: "done", members: [] });
});

test("terminalizeRoster leaves an already-terminal roster untouched", () => {
  const closed = { runId: "run-1", status: "done", members: [] };
  assert.equal(terminalizeRoster(closed), closed);
});

function tmpCrewLaunchDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("terminalizeRostersForRemovedActors marks a roster done once Runtime removed every member", () => {
  const dir = tmpCrewLaunchDir("crew-cleanup-full-");
  try {
    const path = join(dir, "run-active-roster.json");
    writeFileSync(
      path,
      JSON.stringify({
        runId: "run-active",
        status: "started",
        members: [
          { name: "a", actorId: "actor-a" },
          { name: "b", actorId: "actor-b" },
        ],
      }),
    );

    const terminalized = terminalizeRostersForRemovedActors(dir, ["actor-a", "actor-b"]);

    assert.deepEqual(terminalized, ["run-active"]);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      runId: "run-active",
      status: "done",
      members: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminalizeRostersForRemovedActors leaves a roster untouched on a partial removal", () => {
  const dir = tmpCrewLaunchDir("crew-cleanup-partial-");
  try {
    const path = join(dir, "run-active-roster.json");
    const original = {
      runId: "run-active",
      status: "started",
      members: [
        { name: "a", actorId: "actor-a" },
        { name: "b", actorId: "actor-b" },
      ],
    };
    writeFileSync(path, JSON.stringify(original));

    const terminalized = terminalizeRostersForRemovedActors(dir, ["actor-a"]);

    assert.deepEqual(terminalized, []);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminalizeRostersForRemovedActors skips rosters already in a terminal status", () => {
  const dir = tmpCrewLaunchDir("crew-cleanup-terminal-");
  try {
    const path = join(dir, "run-closed-roster.json");
    const original = { runId: "run-closed", status: "done", members: [] };
    writeFileSync(path, JSON.stringify(original));

    const terminalized = terminalizeRostersForRemovedActors(dir, []);

    assert.deepEqual(terminalized, []);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminalizeRostersForRemovedActors is a no-op when no Crews were ever launched", () => {
  const dir = join(tmpdir(), `crew-cleanup-missing-${process.pid}-${Date.now()}`);
  assert.deepEqual(terminalizeRostersForRemovedActors(dir, ["actor-a"]), []);
});
