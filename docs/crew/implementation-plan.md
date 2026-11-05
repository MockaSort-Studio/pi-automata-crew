# Crew and Armory implementation plan

Updated: post-migration to `main`. This plan and Project #10 (`Pi Crew alpha`) define active work.
Current status: [alpha-status.md](alpha-status.md). The product is a functional, secure Pi Crew
runtime and tooling; Claude Code skill/methodology migration is out of scope. `follow-ups.md` and
`armory-implementation-todo.md` retain completed evidence and historical context; they do not define
additional work.

## Release gate

Live canaries now run routinely (one- and two-worker Gondolin Crews on libkrun, a credentialed
GitHub read, leadless chains and Lead-led dispatch). Before every retry or cleanup, archive
worker configuration, events, patches, lifecycle records and process evidence outside TUI state;
a failed launch does this itself (`preserveEvidence`).

## 1. Dispatch control plane

1. [x] **Implement explicit dispatch.** `start_crew` creates a ready run only;
       Main explicitly delivers its first task through Comm. Remove duplicated
       automatic kickoff/direct-prompt paths and apply the contract in the `engineering-execution` skill,
       worker startup, terminal follow-ups, and tests. See
       [dispatch-control-plane-design.md](dispatch-control-plane-design.md).
2. [x] **Support leadless control.** Provide Main-to-member/all delivery and
       correlated request replies without requiring a Lead. Keep agent all-recipient
       broadcast Lead-only and fail closed with typed capability errors.
3. [x] **Make launch and cleanup transactional.** Wait for worker readiness with
       bounded Comm/Lifecycle startup and RPC calls; on failure stop partial processes,
       invalidate clients, archive evidence, terminalize/retire the roster, and remove
       the TUI entry. Cleanup must tolerate already-missing worktrees, agents, and
       records.

Items 1-3 are implemented and unit/integration tested; their live proof is item 9.

### Resume here (dispatch control plane leftovers)

- [x] Dependent release: the Runtime releases each dependent when the ledger marks it ready; failures block dependents (`dependent-release.test.mjs`).
- [x] Lead-led dispatch: Main briefs the Lead, which assigns members with broker-validated `crew_assign` (`lead-led-dispatch.test.mjs`). Superseded text follows:
      Lead-run activation: Main sends the task to the Lead; Lead dispatches
      validated roots through the broker (not built; Main currently sends directly).
- [x] Verify roster `done` + TUI entry retirement on launch failure (`environment-startup.test.mjs`).
- [x] Stop the Comm/Lifecycle servers when a launch rolls back and no other Crew
      uses them (`main-comm.test.mjs`).
- [x] Main tool registration verified after a restart (`runtime_dispatch`, `runtime_acknowledge_message`,
      `runtime_receive_message`, `runtime_cleanup` all used live).
- [x] One-worker canonical E2E on Gondolin with `github_issue_view` (item 9, normal path).

Current local baseline: 449 tests, 446 pass, 3 skipped, 0 fail in about 16 s. CI runs this same
suite and the format check; its first remote run remains to be verified. No live Crew or VM state
remains. Runtime tools are exposed by
`extensions/crew/crew-runtime/index.ts`; design in
[dispatch-control-plane-design.md](dispatch-control-plane-design.md).

## 2. Lifecycle state redesign

4. [x] **Specify separate state domains.** Work state (Comm state owner, `lifecycle-state.mjs`)
       and process state (Lifecycle controller) are separate, and `inspect` reports both
       (`processStatus`, `lifecycleStatus`). The written contract is
       [lifecycle-state-contract.md](lifecycle-state-contract.md). Original scope: Do not use one status for everything:
       model _work_ state, process/VM _health_, and resource _disposition_ separately.
       Define the Crew and member state machines, legal transitions, terminal outcomes,
       ownership, and persisted fields.
5. [ ] **Make the lifecycle service authoritative and durable.** Not built: state is in memory, with a
       durable owner registry only. The service owns
       versioned state plus an append-only transition/audit record. Workers request
       transitions; Main performs administrative transitions; the TUI is query-only.
       Define idempotency, reconnect/replay, stale-writer rejection, and crash recovery.
6. [x] **Define operational semantics.** Explicit registration, readiness, waiting, terminal
       results, process health, resource disposition, and process death separate from work outcome are
       defined in [lifecycle-state-contract.md](lifecycle-state-contract.md). Original scope: Model explicit registration, readiness,
       active work, waiting-for-dependency/input, terminal work result, cleanup, and
       archived evidence. A terminal work result stops further execution; process death
       is health evidence, not an assumed work outcome.
7. [x] **Define dependency and recovery semantics.** Dependents release on success and block on
       failure (`dependent-release`, ledger propagation); evidence is archived before cleanup. Linked retry,
       stale-writer, recovery, and replay semantics are defined in
       [lifecycle-state-contract.md](lifecycle-state-contract.md). Original scope: Release dependents only after
       required successful results; propagate failure/block deterministically. For a
       retry, preserve patch/log/configuration evidence, clean the old resource, and
       create a new member attempt linked to the prior terminal result with explicit
       authority.
8. [ ] **Implement and prove the redesign.** Depends on 5 and the retry part of 7. Original scope: Replace raw-envelope lifecycle writers,
       migrate roster/TUI projections, and cover transitions, duplicate messages,
       disconnect/reconnect, worker/owner death, cleanup races, dependency release, and
       recovery/retry.

## 3. Canonical release evidence

9. [x] **Run canonical `start_crew` E2E.** Normal path live; partial-launch failure and owner death are covered by
       `start-crew-owner-death.test.mjs`, which drives Pi's real model to tool-call path with an offline mock provider, kills the
       owner, and asserts Comm, Lifecycle and the worker exit and the evidence is archived. Original scope: Prove exact
       initial-task delivery, worker registration, typed lifecycle progression, terminal cleanup, and TUI retirement.
10. [x] **Run canonical two-worker Gondolin E2E** (live, repeatedly): guest-proxy registration, shared
        closure identity, distinct VMs and workspaces, no residual VM or worker process. Scope was: Prove guest-proxy registration,
        shared immutable closure identity, distinct VM/workspaces, Main isolation, and
        no residual worker, worktree, Comm/Lifecycle, QEMU, roster, or TUI state.
11. [x] **Bound CI validation.** `.github/workflows/ci.yml` runs `npm ci`, `npm test` (deterministic, about 16 s, live VM tests
        skipped via `HALL_SKIP_GONDOLIN_LIVE_TESTS`) and the format check.

## 4. Armory GitHub acceptance

12. [x] **Complete live read-only GitHub canary** (issue #469 read by a Gondolin worker, equal to the host;
        token never reaches the guest). Scope was: Invoke
        `collaboration/pi-github-tools.github_issue_view` through the guest proxy and
        prove no host suite execution, raw credential artifact, or mutation.
13. [ ] **Add credential renewal and rotation.** Today the lease is taken once from the environment
        (`credentials.mjs`); a renewable source and `secretManager.updateSecret()` are not built.
        13a. [x] **Ship the Armory binary cache** (see
        [armory-distribution-decision.md](armory-distribution-decision.md)). Done:
        hall-armory builds and pushes per suite and verifies fetch-only on Ubuntu and
        macOS; suite source is content-addressed; clients root closures; a missing
        cache yields an actionable host-fallback reason; machine setup UX remains unimplemented.
        Done: slim 39-42 MB closure on the guest's Node with a static `gh`; the
        resolved artifact catalog released by hall-armory after the cache is complete;
        client resolution from the release as the single entrypoint and fetch by
        store path with verification (10 s cold, +38 MB). Also done: the `main`-only `cache` Environment,
        immutable releases, and the Crew canary. Remaining: `CACHIX_AUTH_TOKEN` is still a repo-level secret
        (decided to leave it).
        13b. [x] **Credentials at launch.** A dedicated `HALL_GITHUB_TOKEN`, minted
        deliberately supplied through `HALL_GITHUB_TOKEN`; a launch warning
        with minting instructions when it is missing. Live: a Gondolin worker read a
        public issue through the guest proxy with the credential and matched the host's
        `gh`. Open: capturing then deleting the variable from Pi's environment at
        extension load, and replacing the broad `gh` login token with a fine-grained one.
14. [x] **Profile guest startup.** Measured in [gondolin-benchmark.md](gondolin-benchmark.md): a booted
        VM runs a command in about 2 ms, a `gh` call takes about 93 ms (was 736 ms), a VM boots in under a
        second. The 4.8 s `describe` figure predates the slim closure. Snapshots stay deferred.

## 5. Release-quality policy

15. [~] **Scope Comm capabilities.** Done: a per-Crew auth token, namespace-bound actors, cross-Crew
    routing and observation refused (`comm-access`). Open: per-actor capabilities and replay rejection
    (every actor shares one token). Original scope: Replace shared credentials with launch-, actor-,
    namespace-, and observer-bound capabilities; reject replay and impersonation.
16. [ ] **Add model-selection policy.** Choose model/thinking from task risk and
        scope; record rationale, budgets, and outcome.
17. [ ] **Establish quality/performance evidence.** Capture a baseline, run an A/B
        quality gate, and publish three serial-versus-Crew rounds with median/range.

## 6. Setup UX (last)

18. [ ] **Add `/hall-setup`: the entry point for setting up a new machine.** Re-design this for the
        standalone repository; the former setup scripts were intentionally not migrated. A Pi command
        should run the required setup through the OS's graphical
        elevation (`osascript ... with administrator privileges` on macOS, `pkexec`
        on Linux), because Pi's TUI owns the terminal and a plain `sudo` prompt
        cannot work. One native password dialog installs Nix and the Armory cache.
        It is explicit-only (a Crew never installs anything), pins the Nix installer
        to a tag, and its preflight message points here. Verify the dialog manually
        on macOS and Linux; the script itself is covered by `setup-env.test.mjs`.
        Rationale and alternatives: [armory-distribution-decision.md](armory-distribution-decision.md).

## 7. Gondolin hardening (from [gondolin-benchmark.md](gondolin-benchmark.md))

19. [x] **Fail closed at launch.** The sandbox extension ends the worker when its setup
        fails, and a launch fails as soon as any worker exits before ready.
20. [x] **Guest-local copy of `gh`** (hall-armory PR #6): 736 ms to 93 ms per call.
21. [x] **Idle VM release**, VM warmed when a run starts. Open: embed tool descriptors in
        the release so a held worker never boots a VM at launch (`session_start` boots one today).
22. [x] **Preflight once per Crew.** Smaller guest RAM and libkrun were measured and
        rejected.
23. [x] **No separate `doctor`**: launch-time checks already report dependencies, Nix, the
        cache and the token, with a fallback; a second tool would be more code to drift.
24. [x] **Lighter VM: libkrun by default** where Gondolin ships its runner (macOS arm64,
        Linux x64), QEMU as the fallback, `HALL_VMM` to force one: VM footprint 212 to 100 MB,
        no QEMU install needed on those hosts. Measured against the OS footprint, not RSS.
25. [x] **Compact the isolation layer**: 22 files to 14 (Nix helpers, credentials, guest runner
        merged), dead modules removed.
26. [x] **Core files under 200 lines**: `runtime.mjs` 418 to 166 (`main-comm`, `main-inbox`,
        `server-process`, `crew-launch`, `root-dispatch`), `comm-controller.mjs` 318 to 200
        (`comm-access`, `comm-mailbox`, `comm-readiness`, `lead-assignment`, socket wiring into the
        dispatcher), `startup.mjs` 265 to 193 (`launch-files`, `launch-environment`, `suite-grants`),
        two borderline files trimmed, observer sockets merged, unused exports removed.
27. [x] **Sandboxed Pi footprint measured**: the extra over a host Pi is live VM client state that
        is freed on idle release, not the SDK import; lazy-loading would save nothing. Not built.
28. [ ] **Policy decision for a human:** an active sandboxed worker is about 295 MB (libkrun).
        Going lower means sharing a VM across workers or running read-only roles without one, which
        weakens isolation.

## Deferred until after Crew release

- Hall CLI state-model port and GitHub adapter contracts.
- Terraform guest suite.
- Armory suites beyond GitHub: see [armory-suite-proposals.md](armory-suite-proposals.md).
