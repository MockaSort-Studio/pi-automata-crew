# Crew alpha status

Snapshot: 2026-10-04, `dev`. Built from the docs, follow-ups and designs, checked against the code
and live runs. Active work is tracked in [implementation-plan.md](implementation-plan.md); suites in
[armory-suite-proposals.md](armory-suite-proposals.md); measurements in
[gondolin-benchmark.md](gondolin-benchmark.md).

Verdict: the runtime core is solid for an alpha. The three gaps most likely to bite in real use are
unrestricted guest egress, the Node suite not running in CI, and in-memory lifecycle state. The
roadmap's Saga and heartbeat work is the largest missing product piece.

## Complete

| Area | What exists |
| --- | --- |
| Runtime | Main, then Lifecycle RPC, then worker processes in isolated git worktrees. Transactional launch with rollback, evidence archived before cleanup, a launch that fails fast when a worker exits before ready (live). |
| Dispatch | Explicit dispatch with idempotency. Leadless dependency release (live chain A, B, C). Lead-led dispatch with broker-validated `crew_assign` (live). |
| Comm | Separate WebSocket broker, namespaced actors, request and reply, readiness barrier, Lead-only broadcast, queue-style delivery for Main and the Lead. Main turns start on incoming messages. |
| State | Typed live state and dependency ledger, `PASS`/`BLOCKED`/`FAIL` outcomes, roster rollup (worst outcome wins). `waiting` exists as a worker state. |
| TUI | Per-Crew footer, structured dashboard with real tables and chrome, Crew picker. |
| Isolation | Per-worker Gondolin VM, `auto`/`gondolin`/`none` with host fallback. libkrun by default (QEMU fallback, `HALL_VMM`), idle release, hidden `.env` and `node_modules`. Live on macOS arm64. |
| Armory | GitHub suite (38 typed tools), released and hash-pinned catalog, verified fetch (10 s cold), Ubuntu and macOS CI. |
| Credentials | `HALL_GITHUB_TOKEN` leased to the worker, seen by the guest only as a placeholder; setup script; a live read of issue #469 matched the host. |
| Observability | Per-worker metrics, static context tokens, event logs. |
| Quality | 456 tests (453 pass, 3 skipped), identical over three runs of about 19 s; plugin validation 57/57; no source file over 200 lines; Comm and Lifecycle servers exit when Main dies. |
| Optional | GitHub Discussion adapter, on demand. |

## Needs refinement

| Area | Gap |
| --- | --- |
| Lifecycle | State is in memory. `blocked` takes no structured reason. No written state-machine spec. Retry is not a linked attempt. |
| Comm security | One shared token per Crew; no per-actor capabilities or replay protection. |
| Network | Guest egress is open by default (a default guest reaches example.com; `allowedHosts` blocks it). Not measured with the credential attached. |
| CI | The Node suite does not run in `ci.yml`. The prettier gate fails on 57 files and is not enforced. |
| Launch paths | Launch-failure roster retirement has no test. Owner death is unit-tested but not run through a real `start_crew`. |
| Credentials | The token is the broad `gh` login token. No renewal or rotation. The variable stays in Pi's environment until captured. |
| GitHub suite | `github_issue_update` takes a free-form `state`. The earlier audit flagged issue-state mutation, Project item identity and list contracts; not rechecked in the Armory suite. Discussion reply pagination is open. |
| Memory | About 295 MB per active worker (libkrun). Lower needs a policy decision on isolation. |
| Startup | `session_start` boots a VM at launch, because tool descriptors are not embedded in the release. |
| Portability | libkrun tested on one macOS arm64 machine. The preflight has no KVM check, so a Linux host without KVM would fail at VM start instead of falling back. |
| Docs | `follow-ups.md` is 452 lines, mostly history still labelled "Historical unresolved". |

## Missing

| Area | Gap |
| --- | --- |
| Lifecycle | Durable service, audit log, crash recovery (plan items 5 and 8). |
| Retry | A blocked worker cannot be resumed; the design is to export evidence, remove it and dispatch a fresh, linked actor. |
| Model policy | No selection by task risk, no budgets (item 16). |
| Evidence | No baseline, A/B quality gate, or serial-versus-Crew benchmark (item 17). |
| Setup | `/hall-setup` (item 18). |
| Saga and Lead | The roadmap's heartbeat snapshots and deadline-aware replanning; a search found no heartbeat or deadline code. How much of the Lead rewrite landed is not clear from the roadmap. |
| Hall CLI port | Project progression, Issue closure, dependency management, GitHub adapter contracts. |
| Suites | CI inspection, workflow lint, `act`, `dev/tasks`, prettier, `yq`, `jq`. See the suites todo. |
| Network and `bash` | Default-deny egress, denied-host logging, `bash` telemetry, a `bash`-less `reviewer`. |
| Armory release | Lead-time measurement, suite scaffold, local harness, launch-time catalog check. |
| Platforms | Linux and Windows validation. Terraform suite and VM snapshots are deferred. |

## Measured this cycle

| Question | Answer |
| --- | --- |
| Where does a worker's memory go | The VMM. libkrun 55 MB idle and 100 MB after a workload, QEMU 151 and 212 MB. Guest RAM size and base image make no difference (the guest uses about 80 MB). |
| Active sandboxed worker | About 295 MB with libkrun (about 400 MB QEMU) plus 64 MB of servers per Crew; about 140 MB once the VM is released; a host worker about 134 MB. |
| Why a sandboxed Pi is larger | 54 MB of live VM client state, freed on release; not the SDK import. |
| Cold and warm timings | Armory closure 10 s cold; worker ready 0.6 s (host) and 0.5 to 1.5 s more with a VM; `gh` call 93 ms; real GitHub call about 1.0 s (libkrun). The guest image download was not timed. |
| `act` in the guest | Host mode works without Docker; this repo's `ci.yml` job passed in 3.9 s. The guest is musl-only, with no glibc. |
| Typed tool versus `bash` | A typed tool costs about 130 tokens of schema per turn; `act` output is about 2,700 tokens raw against about 100 compact. |
| microvm.nix | Not adopted: it has no exec API, programmable filesystem, or network interception with secret placeholders. |
