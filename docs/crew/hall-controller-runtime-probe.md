# Hall SDK worktree runtime

## Token ledger

| Case                          | System (est.) | Tool schemas (est.) | Tool calls (est.) | Tool results (est.) | Context after | Provider input/output | Wall time |
| ----------------------------- | ------------: | ------------------: | ----------------: | ------------------: | ------------: | --------------------: | --------: |
| Fabric                        |           763 |                 251 |                19 |                  65 |         1,037 |            2,837 / 96 |   9.827 s |
| SDK                           |           350 |                 151 |                73 |                  65 |         1,050 |           1,905 / 106 |   9.276 s |
| SDK native Discussion comment |           796 |                  86 |                26 |                  83 |           940 |              924 / 16 |   7.030 s |

Estimates are serialized model-facing content ÷ 4. Context after is Pi `getContextUsage().tokens` after settlement. SDK case: [Discussion #445](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/445).

SDK native Discussion comment: disposable Discussion #450; `github_discussion_post` extension call; 1,702 ms tool duration; marker externally verified, then the Discussion and worktree were deleted.

## Runtime design

### Current implementation

```mermaid
flowchart TB
  Main[Main Pi session]
  Client[Runtime native tools]
  Lifecycle[In-memory lifecycle manager]
  Workers[SDK worker processes + worktrees]
  Logs[Per-agent JSONL]

  Main --> Client --> Lifecycle --> Workers
  Workers --> Logs
```

- One agent is one fresh worktree and one standalone Pi SDK process.
- The worker owns its `AgentSession`, selected tools/extensions, and telemetry.
- The lifecycle manager is currently in Main's runtime extension and is intentionally in-memory.
- Agents run in parallel; delete stops the process and removes its worktree.

### Communication controller

```mermaid
flowchart TB
  Main[Main Pi session]
  Client[Runtime client]
  Comm[Dedicated Crew Comm process]
  Workers[SDK worker processes]
  Adapters[Future adapters]

  Main <--> Client <--> Comm
  Workers <--> Comm
  Comm --> Adapters
```

- One Comm process owns the Crew actor registry, mailboxes, connections, and protocol ledger.
- Main and workers use WebSocket JSON-RPC; no process shares mailbox state.
- The process serializes mailbox operations; messages are queued, claimed for one-shot startup, or delivered to a connected resident worker.
- Adapters attach to Comm; they do not own mailbox state or worker lifecycle.
- `comm_emit` optionally requests a reply; `comm_reply` binds to the current delivery, so agents never supply recipient or correlation metadata.

## Source map

| Concern                                                | Source                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Main-facing lifecycle tools                            | [.pi/extensions/hall-crew/crew-runtime/index.ts](../../.pi/extensions/hall-crew/crew-runtime/index.ts)                                                   |
| Current lifecycle manager and worktree/process control | [.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs](../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs)                                     |
| SDK worker and JSONL telemetry                         | [.pi/extensions/hall-crew/crew-runtime/lib/worker.mjs](../../.pi/extensions/hall-crew/crew-runtime/lib/worker.mjs)                                       |
| Named tool bundles                                     | [.pi/extensions/hall-crew/crew-runtime/lib/tool-bundles.mjs](../../.pi/extensions/hall-crew/crew-runtime/lib/tool-bundles.mjs)                           |
| Native Discussion tools                                | [armory/collaboration/github/src/lib/discussions/tools.ts](../../armory/collaboration/github/src/lib/discussions/tools.ts) |

## Observability

Write per-run and per-agent JSONL outside model context:

- run/agent start, end, exit, error, elapsed time;
- model and thinking level;
- provider input/output/reasoning/cache usage;
- context before/after;
- system prompt and tool-schema estimates;
- tool name, source (native/extension/custom), call/result estimates, duration, outcome.

No raw prompts or tool output by default.

## Plan

1. Build one SDK runner: fresh worktree, one bounded task, final status, JSONL telemetry.
2. Build Lifecycle spawn/list/delete around that runner.
3. Run two SDK agents in parallel; verify independent worktrees, logs, and deletion cleanup.
4. Add future concerns separately: durability, communication, sandboxing.

## Flat message envelope

Comm owns a flat V1 envelope: `v`, `id`, `kind` (`notify`, `request`, or `reply`), `from`, `to`, `payload`, `createdAt`, and optional `replyTo`. `comm_request` creates a request; `comm_reply` creates a reply correlated by `replyTo`.

The worker projection is deliberately smaller: `{ from, payload, replyRequired }`. IDs, destination, timestamps, kind, and correlation stay in the controller. Delivery acknowledgement is independent of a required application reply; disconnect before acknowledgement requeues the inflight message.

## Lifecycle process

Lifecycle ownership now runs outside the Main extension process. Main keeps the same native API (`spawn`, `list`, `inspect`, `delete`) but delegates over RPC to a Lifecycle process that owns worker process handles, Git worktree creation/removal, and worker telemetry inspection. Comm remains a separate process; Runtime registers/claims any pending actor delivery with Comm, then passes only the worker config and claimed delivery to Lifecycle.
