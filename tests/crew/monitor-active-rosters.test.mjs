import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  activeRosterEntries,
  crewPickerItems,
  MAX_ACTIVE_ROSTERS,
} from "../../.pi/extensions/hall-crew/crew/lib/monitor-active-rosters.mjs";

const ACTIVE = new Set(["queued", "launching", "starting", "started", "closing"]);

const entry = (path, status, mtimeMs, overrides = {}) => ({
  path,
  mtimeMs,
  roster: { runId: path, status, members: [], ...overrides },
});

test("activeRosterEntries keeps only active-status rosters", () => {
  const entries = [entry("a", "started", 10), entry("b", "done", 20), entry("c", "queued", 5)];
  const result = activeRosterEntries(entries, ACTIVE);
  assert.deepEqual(
    result.map((e) => e.path),
    ["a", "c"],
  );
});

test("activeRosterEntries sorts most-recently-touched first", () => {
  const entries = [entry("old", "started", 1), entry("new", "started", 100), entry("mid", "started", 50)];
  const result = activeRosterEntries(entries, ACTIVE);
  assert.deepEqual(
    result.map((e) => e.path),
    ["new", "mid", "old"],
  );
});

test("activeRosterEntries is bounded so a pile of active rosters can't grow the footer/picker without limit", () => {
  const entries = Array.from({ length: MAX_ACTIVE_ROSTERS + 3 }, (_, i) => entry(`r${i}`, "started", i));
  const result = activeRosterEntries(entries, ACTIVE);
  assert.equal(result.length, MAX_ACTIVE_ROSTERS);
  // Still the most-recently-touched ones, not an arbitrary truncation.
  assert.deepEqual(
    result.map((e) => e.path),
    ["r7", "r6", "r5", "r4", "r3"],
  );
});

test("activeRosterEntries honors an explicit max override", () => {
  const entries = [entry("a", "started", 3), entry("b", "started", 2), entry("c", "started", 1)];
  assert.equal(activeRosterEntries(entries, ACTIVE, 2).length, 2);
});

test("crewPickerItems describes each entry with the same phase crewMonitorView derives for the footer", () => {
  const entries = [
    entry("path-a", "started", 10, {
      runId: "run-aaaaaaaa",
      discussionUrl: "https://example/1",
      members: [{ name: "x" }],
    }),
    entry("path-b", "queued", 5, { runId: "run-bbbbbbbb", discussionUrl: null }),
  ];
  const items = crewPickerItems(entries);
  assert.deepEqual(items, [
    { value: "path-a", label: "Crew run-aaaa \u00b7 Working", description: "https://example/1" },
    { value: "path-b", label: "Crew run-bbbb \u00b7 Queued", description: undefined },
  ]);
});

test("crewPickerItems drops an entry that has gone terminal between the scan and the render", () => {
  const entries = [entry("path-a", "done", 10)];
  assert.deepEqual(crewPickerItems(entries), []);
});
