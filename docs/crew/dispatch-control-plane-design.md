# Dispatch control-plane design

Status: implemented (unit/integration level). Manifest kickoff, authenticated
`comm.ready` readiness barrier (30 s), broker-enforced Lead-only broadcast,
recipient-only replies, Main send/send-all/request/reply/acknowledge, one-shot
idempotent `runtime_dispatch` of root tasks, and evidence archiving to
`.pi/runtime/archive/<actor>` on launch rollback are in place. Remaining: live
canonical E2E and roster/TUI retirement proof.

## Findings

The previous duplicate direct-prompt and Comm kickoff paths have been removed.
The remaining determinism gaps are:

1. `launchPreparedCrew()` broadcasts the manifest after worker process spawn, not
   after authenticated worker readiness. A worker can exit before connection while
   the roster is still marked `started`.
2. Main has direct `Runtime.send(to, payload)` and `Runtime.broadcast(namespace,
   payload)` methods, but the exposed Main tool accepts only one exact recipient.
   The literal recipient `all` is invalid. Agent request correlation exists in the
   broker but Main has no typed `replyTo` surface.
3. Agent all-recipient broadcast is role-tool gated, while Main broadcast is not.
   This is correct authority separation but is not represented by a clear API.
4. Reply correlation tracks an outstanding request but must also enforce that only
   its original recipient may reply.

Relevant sources: `crew/lib/startup.mjs`, `crew/lib/kickoff-payload.mjs`,
`crew-runtime/lib/worker.mjs`, `worker-comm-extension.mjs`, `runtime.mjs`,
`comm-controller.mjs`, `comm-controller-dispatch.mjs`, and `comm-client.mjs`.

## Contract

`start_crew` creates a run and starts resident workers. It broadcasts one compact
non-turn-triggering kickoff **manifest**: directory, plan shape, and run identity,
never detailed assignments. The run is `ready` only after every required worker
has authenticated with Comm and explicitly announced readiness. Main then uses a
typed dispatch command to deliver the first task. A task is a normal Comm envelope,
not a second out-of-band Pi prompt.

A run has three dispatch-control states:

```text
preparing -> registering -> ready -> dispatched -> closing
                 \-> failed
```

These are control-plane states only. They must not replace the revised work,
health, or resource-disposition lifecycle states.

## Authority and routing

| Sender | Allowed recipients | Operations |
| --- | --- | --- |
| Main | one member, all run members, a request origin | notify, request, reply, dispatch |
| Lead | one member, Main, all run members | notify, request, reply, broadcast |
| Specialist | one member or Main | notify, request, reply |
| Leadless specialist | one member or Main | notify, request, reply; never all |

`all` is an API selector, never an actor ID. Main broadcast excludes Main by
default. Lead broadcast may include Main only when explicitly requested. Every
non-Main actor ID is namespace-qualified by the broker; callers use stable member
handles and the Runtime resolves them. Cross-run recipients fail closed.

A request creates a broker message ID. `reply(requestId, payload)` is accepted
only once, only from the original recipient, and returns `Unknown`, `Already
replied`, or `Not request origin` as typed errors. Main receives a request in its
inbox without automatic acknowledgement; `runtime_reply` atomically emits the
reply and acknowledges the request.

## Delivery and readiness

1. Start Comm and Lifecycle; persist only `preparing` metadata.
2. Spawn workers without `delivery` and without a specialist initial task prompt.
3. Broadcast the compact kickoff manifest; workers acknowledge it without a model
   turn and retain it as trusted runtime context.
4. Each worker opens authenticated Comm, registers once, then emits a typed
   `worker_ready` control event after its Pi session is usable.
5. Runtime waits for all required ready events within a bounded timeout. It writes
   `ready` plus the member identity mapping only after that succeeds.
6. Main sends `runtime_dispatch` (one member) or `runtime_dispatch_all` (all
   roots). The broker persists the envelope before delivery; a worker invokes Pi
   only after claiming it and acknowledges after its turn settles.
7. Repeating the same dispatch idempotency key returns its original result;
   a different initial dispatch after `dispatched` fails.
8. On registration timeout, disconnect before readiness, or launch error: archive
   evidence, stop spawned resources, mark dispatch control `failed`, and remove
   the active TUI roster entry.

## Dependent release (implemented)

`runtime_dispatch` delivers the root tasks. Every other member waits, and the
Runtime sends its task exactly once, the moment the typed ledger marks it `ready`
(every prerequisite `complete`); the payload carries its `prerequisites`. The
ledger owns the rest: a prerequisite that fails or blocks moves every transitive
dependent to `blocked` itself, so those members are never released and the Crew
still reaches a terminal state and reports it. A prerequisite that finished before
the subscription is covered by an initial snapshot.

No role starts a turn at launch. A Lead once did (`initialTurn: startup`), which
let a Lead with dependencies run its task text before dispatch and its
prerequisites; every role now waits for its first delivery.

## Lead-led dispatch (implemented)

A Crew with a Lead is Lead-led: **Main briefs the Lead, and the Lead hands out the
work.** `runtime_dispatch` sends the Lead alone a briefing (the objective, and the
plan: each member's planned task and prerequisites); every other member waits. The
Lead calls `crew_assign` once per member, and the broker validates each call against
the registered plan:

- only the Lead of that Crew may assign, and never itself or anyone outside the plan;
- the member receives the plan's own task (a Lead cannot substitute another), with an
  optional bounded `note` from the Lead and a `reportTo` naming the Lead;
- a member whose prerequisites are not all `complete`, one already assigned, and one
  already terminal are refused, so each member is assigned at most once and a failed
  prerequisite still blocks its dependents through the ledger.

Members report to the Lead, which reports the outcome to Main. There is no automatic
release in a Lead-led Crew; the Lead owns the order. The Lead is the entry point and
cannot depend on other members (rejected at launch).

A leadless Crew is unchanged: Main dispatches the roots and the Runtime releases each
dependent when its prerequisites complete. No role starts a turn at launch (a Lead once
did, which let a Lead run its task text before dispatch); every role waits for its
first delivery.

## Implementation seams

- Keep `kickoffPayload` as the compact manifest, but remove `agent.delivery`
  from `crew/lib/startup.mjs`; use an explicit run-dispatch record for work.
- In `worker.mjs`, remove delivery text from `sendStartupPrompt()`. Resident
  workers establish a Pi session solely to become ready.
- In `worker-comm-extension.mjs`, retain the manifest acknowledgement special
  case and add one authenticated `worker_ready` control RPC after Comm and Pi are
  live.
- Add broker control APIs for readiness and typed reply errors in
  `comm-controller.mjs` and `comm-controller-dispatch.mjs`.
- Add Runtime methods and Main tools: `runtime_send`, `runtime_send_all`,
  `runtime_request`, `runtime_reply`, and one-shot `runtime_dispatch`.
- Keep agent `comm_notify`, `comm_request`, and `comm_reply`; make the
  Lead-only all broadcast explicit in its schema and broker enforcement.
- Make roster/TUI read dispatch-control state from the broker/Runtime result,
  not from optimistic file writes before worker readiness.

## Required tests

1. `start_crew` emits one compact manifest kickoff, but no specialist task
   envelope or Pi prompt.
2. A run becomes ready only after every worker registers and reports ready.
3. Main can send one member, all members, request, and correlated reply.
4. `all` cannot be used as an actor ID; namespace/role authorization is enforced.
5. A leadless Crew permits Main-to-all but denies specialist-to-all.
6. Initial dispatch is ordered, persisted, exactly-once by idempotency key, and
   acknowledged only after turn settlement.
7. Registration timeout, pre-ready worker death, duplicate readiness, duplicate
   reply, and Comm reconnect leave no queued roster/TUI/process residue.
8. The canonical Gondolin E2E proves a ready run, explicit dispatch, guest read,
   terminal reporting, and owner-death cleanup.
