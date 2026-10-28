// Pure per-actor state shaping for the Crew monitor. Split out of monitor.ts
// so it is directly unit-testable: monitor.ts itself cannot be imported by
// plain `node --test` (it needs the real pi-tui package, only resolvable
// inside an actual running `pi` process), so any logic left inline there
// can only ever be regex-matched, not exercised with real inputs. This
// exact module exists because of a real bug that regex-matching missed:
// pre-filling a missing member.status to "queued" here silently defeated
// monitor-snapshot.mjs's bucketFor() worker-metrics activity fallback,
// which only fires when the lifecycle entry is genuinely absent.

// Per-member roster status already speaks the lifecycle-state.mjs
// vocabulary (queued/running/attention/PASS/BLOCKED/FAIL) once
// roster-lifecycle.mjs has advanced it. A member with no recorded status
// is left OUT of this map entirely -- never defaulted to "queued" here --
// so bucketFor()'s worker-metrics activity fallback can still apply.
export function lifecycleByActor(roster) {
  return Object.fromEntries(
    (roster?.members ?? [])
      .filter((member) => member?.actorId && member?.status)
      .map((member) => [member.actorId, member.status]),
  );
}
