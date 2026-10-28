# Comm-native kickoff and dependency design

## Implemented flow

The Lead sends one `comm_kickoff` broadcast to Crew actors only. It contains a
shared goal, relevant context, and one assignment per local member handle:

```text
to, task, done, dependsOn[]
```

Workers execute independent assignments immediately and wait for directed
completion messages from prerequisites. Completion reaches the Lead and direct
dependents only. Neither kickoff nor `comm_notify_all` reaches Main; broadcasts address the Crew only.

## Remaining dependency work

- Make waiting and release a deterministic worker state machine.
- Validate handles, reject cycles, and report unsatisfied dependencies.
- Define failed-dependency timeout, retry, and blocked behavior.
- Add an end-to-end parallel-root and chained-release test (tracked as #464).

complete/fail/blocked transitions now fire from live envelopes via the
`taskStatus` report field above (#462); the ledger no longer only reacts to
kickoff.

## CommAdapter

A CommAdapter is a controller-side projection of ordinary Comm exchanges. It is
not a worker tool and does not create another agent-coordination protocol.

```text
CommController.emit(envelope) → adapter(message) → external channel
external human message → adapter → CommController.injectHuman(message)
```

The adapter host selects a factory by `config.id` and starts it with the
controller and adapter-specific config:

```ts
type AdapterMessage = {
  id: string;
  kind: "notify" | "request" | "reply";
  from: string;
  to: string;
  message: string;
  replyTo?: string;
};

type CommAdapterFactory = (
  controller: {
    subscribe(handler: (message: AdapterMessage) => void): () => void;
    injectHuman(input: { to: string; body: string; author?: string; externalId?: string }): {
      accepted: true;
      id: string;
    };
  },
  config: unknown,
) => Promise<{ stop(): Promise<void> }>;
```

Comm retains its full internal envelope for worker delivery. Before calling an
adapter, the controller projects only the fields above. It extracts the first
plain human-readable value from `payload.message`, `summary`, `report`,
`content`, `finding`, `findings`, or `evidence`; it never renders raw JSON.
`id` and `replyTo` retain request/reply threading.

A new channel adds a factory to `adapter-host.mjs`; Telegram and a custom UI use
the same `subscribe()` and `injectHuman()` boundary.

### Raw envelope observation

Internal runtime observers (e.g. the dependency ledger) need more than an
adapter: payload `kind`, kickoff assignments, and other structured fields that
the human-readable projection above drops. `CommController.observeRaw(handler)`
subscribes to the full flat V1 envelope, unfiltered, alongside `subscribe()`.
Both read from the same `comm-envelope-observation.mjs` module so the
controller itself does not grow as ledger/DAG concerns are added.

Raw envelope observation is now primarily an _implementation detail of the
Comm server itself_, not something remote callers use directly. See "Typed
live state" below.

### Typed live state

The Comm server owns one dependency-ledger per registered Crew run
(`comm-state-owner.mjs`), fed by its own in-process `observeRaw()` stream.
A launcher registers a run's static plan shape once
(`CommController.registerPlan(namespace, members)`, exposed over WS as
`comm.register_plan`); `Runtime.launchCrew()` does this automatically when
given a `plan`. Remote callers never reconstruct the DAG themselves:

```text
comm.state_snapshot { namespace } -> { namespace, nodes: [{ handle, status, dependsOn, task }] }
comm.observe_state  { namespace } -> pushes comm.state_update { namespace, nodes: [{ handle, status }] }
```

The TUI's Plan tab/footer (`monitor-live-ledger.mjs`) is a read-only
projection of this API: it polls a snapshot once per connection and applies
subsequent compact `comm.state_update` pushes, overlaying them on the static
plan shape it already knows from `selected_crew_<uuid>.json`. It performs no
DAG computation and never touches a raw envelope. Transport is unchanged --
the same portable WebSocket/Comm channel `subscribe()`/`observeRaw()` already
used, no Unix sockets or platform-specific shared memory.

### Task completion signal (`taskStatus`)

A `kind: "report"` payload may carry a `taskStatus` field of `complete`,
`failed`, or `blocked`. This is the minimal Comm-native signal that marks a
task's ledger node leaving `running`. It is deliberately distinct from the
unrelated lifecycle `status` field some reports already carry (`PASS` /
`BLOCKED` / `FAIL`, the roster-level outcome vocabulary) — `taskStatus` is
lower-case and ledger-scoped, `status` is upper-case and lifecycle-scoped.

`taskStatus` is keyed by the envelope's own `from` field, never by an
in-payload handle: a report can only ever move the ledger node for the actor
that sent it, so one Crew member cannot claim completion on another's behalf.
`dependency-ledger-wiring.mjs`'s `attachRawEnvelopeObserver` reads it directly
from the same `observeRaw()` stream that already drives kickoff, alongside
kickoff-driven `waiting`/`ready` → `running` transitions:

```text
kind: "report", taskStatus: "complete" → ledger.complete(envelope.from)
kind: "report", taskStatus: "failed"   → ledger.fail(envelope.from)
kind: "report", taskStatus: "blocked"  → ledger.block(envelope.from)
```

An unknown sender, a node not currently `running`, a missing `taskStatus`, or
an unrecognized value is silently ignored — the same untrusted-input handling
already applied to kickoff envelopes. Emitting `taskStatus` is optional for
callers; a report without it (e.g. a plain progress notify) never moves the
ledger.

## GitHub Discussion adapter

Each Crew run starts `github-discussion` by default; set `githubDiscussion: false`
to opt out. It creates or recovers one run Discussion:

```text
Crew - <run UUID> - <YYYY-MM-DD>
```

The adapter persists the Discussion identity and comment-poll cursor in its
run-local state file. It maps each Comm request ID to the GitHub comment node ID.
A notify or request is a top-level comment; a Comm reply is posted beneath the
mapped request.

```md
@architect-hamlet-00

Plain message.

lead-old-major-00
```

Replies omit the recipient mention and contain only the message and sender
signature. Human input follows the inverse mapping:

- `@architect-hamlet-00 message` targets that exact Crew handle.
- A comment without a target goes to the Lead.
- There is no human broadcast command.

Adapter-authored comments carry an invisible Comm marker and are ignored during
polling, preventing echo. Human input becomes an ordinary correlated Comm
request, so `comm_reply` renders under the original human comment.
