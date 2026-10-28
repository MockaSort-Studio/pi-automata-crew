# Crew sprint-lifecycle roadmap (draft)

Status: agreed direction, not yet an implementation specification.

## Goal

Port Hall capabilities to Pi. Crew is supporting runtime infrastructure, not the
centre of the product: it should make those capabilities faster, more reliable,
and independently executable.

## 1. Move initial Crew assembly and spawn to Main

This first step is deliberately narrow. Replace the current lifecycle in which the
Lead recruits and spawns specialists with a Main-owned initial assembly:

1. Main selects the initial Crew and prepares all member definitions.
2. Main/Fabric creates and registers that complete roster.
3. Main gives the goal and already-live roster to the Lead.
4. The Lead puts work in motion through its kickoff, decomposition, and
   assignments.

The result is that the Lead starts as a coordinator of an existing Crew rather
than an infrastructure recruiter. Preserve the current task/dependency mechanics
for this step; backlog claiming, scheduler changes, heartbeat policy, and broader
Fabric simplification belong to later design work.

## 2. Improve the Lead role

Rewrite the Lead prompt and tools around this facilitation role:

1. inspect preassembled roster and goal;
2. create the structured kickoff/work graph;
3. use heartbeat summaries to intervene only when judgment is required;
4. replan against deadline and acceptance evidence;
5. synthesize and close after Fabric-verified cleanup.

The Lead should not be the scheduler, monitor implementation, recruiter, or
message relay. Heartbeats and status collection are Fabric code; the Lead makes
policy decisions from their compact evidence.

## 3. Port Saga as the first tangible capability

Trace the Claude plugin's existing Saga semantics end-to-end before adapting
implementation details:

```text
decompose → dispatch ready waves → track/monitor → unblock/replan → accept
```

Map those semantics onto the new Pi primitives: preassembled roster, structured
work graph, dependency-aware dispatch, fixed heartbeat, direct peer
communication, and deadline-aware review. Preserve Saga behaviour where it is
product capability; replace Claude-specific task machinery with Fabric durable
state.

## Deferred decisions

- Exact roster/work-item schema and compatibility/migration plan.
- Whether every fixed heartbeat wakes the Lead or only persists a snapshot and
  wakes it on configured conditions.
- Initial cadence, deadline defaults, concurrency caps, and timeout policy.
- Fabric runtime simplification and authoritative runtime-tool availability.
- Token optimisation: evaluate it after latency instrumentation, by outcome and
  per-agent cost rather than raw minimisation.

## Acceptance evidence for step 1

A representative run must show: all eligible initial members are created and
registered without serial Lead recruitment; independent work starts in parallel;
dependent work releases immediately on prerequisites; fixed heartbeat snapshots
are durable; and final cleanup leaves no actors or roster members.
