# Pi Crew Runtime Structure

Status: canonical for `dev`.

## Supported entrypoints

Pi discovers project-local extensions:

- `.pi/extensions/hall-crew/crew/index.ts` — Crew orchestration.
- `.pi/extensions/hall-crew/crew-runtime/index.ts` — SDK Lifecycle and Comm runtime.
- Armory suites resolve from external `MockaSort-Studio/hall-armory`; Hall CLI has no local Armory/GitHub source tree.
- `.pi/extensions/web/index.ts` — bounded web fetch.

`tests/pi/test-extension-load.sh` is the relocation smoke test.

## Launch path

1. Main calls `start_crew`.
2. Crew writes a queued config and roster under `.pi/runtime/crew-launch/`.
3. `start_crew` calls the SDK Runtime directly.
4. Runtime starts Comm and its configured adapters, registers every actor, starts Lifecycle, then launches resident specialists and the one-shot Lead.
5. The GitHub Discussion adapter creates the canonical Discussion and mirrors Comm exchanges; the Lead wakes specialists through Comm and owns review and closure.

There is no generated `fabric_exec` launch code, Fabric actor creation, mesh startup signal, or extension-side supervisor.

## Worker model

- Lead: `lead-old-major`, initially one-shot.
- Specialists: assembled Crew roles, resident SDK workers.
- Lifecycle owns worker process handles, worktrees, inspection, and removal.
- Comm owns per-actor mailbox state, delivery, acknowledgement, requeue, and request/reply correlation.

Assembly combines only reusable checked-in persona, role discipline, safety contract, and allowed tools. Crew startup adds the run-specific assignment, run/topic metadata, and exact ordinal-suffixed Comm sender handle; the reusable persona never claims a runtime identity. Runtime adds only `comm_notify`, `comm_request`, and `comm_reply`.

Crew derives each worker profile from assembled `actor.tools`: built-ins and Armory operations execute through Env in the guest, while Comm stays host-side. Armory operations appear in a worker Pi session only as generic proxies for guest-described approved descriptors; no Armory implementation loads in host Pi. Pi's subagent runtime remains the worker mechanism; Env adds no agent or RPC topology.

## State and communication

- Roster JSON is the durable Crew identity and Discussion lifecycle record.
- GitHub Discussion is the durable human-readable evidence record.
- Comm carries lightweight coordination only.
- Controller envelope is flat V1: `v`, `id`, `kind`, `from`, `to`, `payload`, `createdAt`, optional `replyTo`.
- Workers see only `{ from, payload, replyRequired }`.
- Sender identity is the roster handle. SDK workers have no Fabric actor identity dependency.

## Closure

Lead records acceptance and closes the Discussion through Crew tools. Runtime/Main owns SDK worker cleanup. Human-gated scheduling is not yet supported by the SDK Crew path.

## Removed paths

Do not reintroduce:

- Fabric actor creation/removal for Crew execution;
- mesh topics for Crew launch or substantive communication;
- generated launch code or user follow-up injection;
- raw shell as ordinary specialist capability;
- unsupported role capabilities outside their bounded tool grants.

## SDK stabilization status — 2026-09-17

The base Crew runtime is SDK + Comm. New Crew runs configure the GitHub Discussion adapter by default; set `githubDiscussion: false` to run without it.

- Actor IDs are run-scoped (`crew-<runId>-...`), preventing concurrent Crew mailbox/worktree collisions.
- Lead startup and specialist first-delivery behavior use explicit `initialTurn` configuration rather than prompt-text detection.
- Lifecycle creates/removes worktrees asynchronously with bounded Git commands and compensating cleanup on failed spawn.
- Lifecycle RPC dispatch awaits controller operations; client pending requests reject on close/error/timeout.
- `Runtime.launchCrew` rolls back already-created workers on a later spawn failure.
- `runtime_cleanup`/`Runtime.stop` remove tracked workers before controller shutdown.

Focused validation: Crew startup, Comm controller/runtime tests, extension-load test, and live Comm request/reply all passed. Remaining hardening is dedicated lifecycle failure-injection/RPC protocol test coverage and a concurrent two-Crew cleanup probe.
