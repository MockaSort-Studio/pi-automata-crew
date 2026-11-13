# Durable lifecycle, audit, and retry contract

Status: accepted design for issue #29. This contract precedes durable-state implementation.

## Scope and authority

A **run** is one immutable Crew attempt. A **member attempt** is one immutable
execution of one selected member inside that run. Comm owns dependency/work
progress; Lifecycle owns process and resource facts; the durable lifecycle
store owns their auditable projection. The TUI, roster JSON, and Discussion
are projections only and never transition state.

Every mutation carries `runId`, `attemptId`, `actorId` where applicable,
`eventId` (UUID), `writer`, `expectedVersion`, and `occurredAt`. The store
assigns a monotonically increasing `version` and `recordedAt`.

| Writer               | May request                                               | May commit                 |
| -------------------- | --------------------------------------------------------- | -------------------------- |
| Worker               | readiness, work progress, report, blocked reason          | nothing directly           |
| Comm controller      | dependency/work transitions                               | its authenticated run only |
| Lifecycle controller | process health and resource disposition                   | its authenticated run only |
| Main                 | launch, cleanup, retry, administrative terminal decisions | its authenticated run only |
| Recovery service     | reconciliation facts after a lease expires                | fenced stale attempts only |

## Separate state domains

### Work state (per member attempt)

`queued -> assigned -> running -> waiting -> running -> {passed, failed,
cancelled}`, with `running -> blocked -> {running, waiting}`. `waiting`
requires a typed wait reason. Terminal work states (`passed`, `failed`,
`cancelled`) never transition. A dependency may be released only after every
required predecessor is `passed`; a predecessor in `failed`, `blocked`, or
`cancelled` deterministically blocks the dependent.

`blocked` is resumable, not terminal. A member that blocks itself resumes when
it receives the input it asked for (its next delivery reports `running`). A
dependent blocked only because a predecessor is blocked cannot leave that state
itself; it returns to `waiting` once no predecessor holds it. A Crew whose
members are all settled with any `blocked` asks Main for input rather than
reporting termination. It notifies once per settling: a member reporting
`running` again (or, on the Comm path, any snapshot with an unsettled node)
re-arms the notice, so settling again after a resume notifies again.

`blocked` requires:

```json
{
  "code": "dependency_failed|human_input_required|policy_denied|environment_unavailable|budget_exhausted|external_unavailable",
  "message": "bounded human-readable explanation",
  "evidenceRefs": ["audit-event-or-archive-ref"],
  "escalateTo": "main|lead|human"
}
```

A worker exit does not itself choose a work result. Lifecycle reports the
health fact; Main or Comm records `failed` only when the typed policy maps the
fact to that result. Unresolved intentional removal maps to `blocked` with
`environment_unavailable`.

### Process / VM health (per resource lease)

`requested -> starting -> ready -> unhealthy -> exited` with `stopping` as the
only administrative branch (`starting|ready|unhealthy -> stopping -> exited`).
Health is non-terminal while a resource can reconnect. It records PID/VM id,
heartbeat, exit code/signal, and lease epoch, never a work outcome.

### Resource disposition (per attempt)

`unallocated -> allocated -> releasing -> archived -> reclaimed`. Evidence
must be copied to immutable attempt storage before `reclaimed`. `archived` is
terminal for the resource, but not evidence deletion. A retry receives new
resource identifiers and never reuses a live lease.

## Transition protocol

1. Authenticate the writer capability, run/attempt identity, and lease epoch.
2. Deduplicate by `(attemptId, eventId)`: the same payload returns its original
   result; a different payload with that key is rejected.
3. Reject a stale `expectedVersion`, a stale lease epoch, illegal transition,
   or writer without authority. Return the current version and snapshot.
4. Atomically append the accepted transition to the audit log and update the
   materialized snapshot. The append record is authoritative.
5. Publish the new version to reconnecting observers. Projections may lag and
   must display the durable version they last observed.

Audit records are append-only JSON lines or equivalent transactional rows:
`version`, IDs, prior/next domain values, writer identity, reason/code,
correlation ID, and evidence references. They never contain credential values,
request bodies, or unbounded logs.

## Reconnect, replay, and recovery

A client reconnects with its run capability, lease epoch, and last seen
version. The service returns ordered events after that version; if compacted,
it returns a snapshot plus subsequent events. Replayed events use the same
`eventId` and are idempotent. A new owner epoch fences every old writer.

At startup, recovery rebuilds snapshots from the audit log, then reconciles
recorded leases with OS process/VM facts. A dead owner triggers resource
shutdown, evidence archival, and a recorded `owner_lost` health event. It does
not invent a successful work result. Missing or corrupt evidence is recorded
as an audit fact and escalated as `blocked`.

## Retry

Retry is not a transition of a terminal attempt. Main creates a new attempt
with `retryOf`, `retryReason`, explicit authority, fresh event/lease epochs,
and a copied immutable input/configuration reference. Prior config, logs,
patches, audit records, process evidence, and terminal result remain retained.
The old resource must be `archived` before the new attempt becomes `assigned`.
Dependency release consumes the selected current attempt only; audit history
keeps the complete retry chain.

## Implementation acceptance

Persistence work must prove: transition legality and stale-writer rejection;
duplicate replay; snapshot plus replay reconstruction; owner-death recovery;
blocked-reason validation; archive-before-reclaim; and a linked retry with no
resource or evidence reuse.
