# Armory implementation todo

This is the live implementation ledger. Update its state with every completed
or partially completed milestone; `[~]` means implementation exists but is not
wired through the worker lifecycle. Active remaining work is canonicalized in
[implementation-plan.md](implementation-plan.md); unchecked items below are
historical notes, not a second backlog.

## Complete

- [x] Document host Crew/Pi, Env proxy, and guest-suite execution boundaries.
- [x] Define Nix as the sole Armory materializer and artifact cache.
- [x] Compile fixed worker `actor.tools` profiles from roles and roster.
- [x] Prove Gondolin isolation/COW and exact read-only Nix `gh` closure mounts.
- [x] Build the GitHub guest suite with locked Nix inputs, runner, extension
  implementation, Node, and `gh`.
- [x] Keep Nix/runner inputs out of the standard Pi npm package.
- [x] Define and smoke-test guest-runner `describe`/`invoke` behavior.

## Immutable suite source identity

- [x] Add explicit `native.output` to suite manifests and a root Armory flake.
- [x] Resolve the catalog once to its immutable revision. (Superseded: the released
  `artifacts.json` is now the only entrypoint; there is no flake path.)
- [x] Record the resolved catalog revision in each launched Armory worker
  configuration before Pi starts.

## Current: Env guest-suite bridge

- [x] Prepare selected worker suite-flake outputs through Nix; the active
  worker path does not use npm package/native installation.
- [x] Resolve each selected output's exact recursive Nix-store closure paths.
- [x] Mount only those paths read-only in its worker-local VM using one
  security-reviewed filtered `/nix/store` provider that exposes exactly the
  selected closure entries.
- [x] Add guest `describe`/`invoke` transport using typed request/result files
  and the guest `armory-suite` executable.
- [x] Derive and verify runner authorization from the suite manifest, final
  worker grants, and guest-described operation projection.
- [x] Run the complete bundled GitHub runner inside Gondolin using the filtered
  single-store provider; `describe` returned the approved GitHub operation.

## Worker-local VM boundary

- [x] Keep VM ownership in the worker-local Pi runtime extension. Its Nix mount
  configuration is trusted runtime state, never model-visible tool data; it
  must not import suite modules or execute suite binaries on the host.
- [x] Have outer `worker.mjs` prepare immutable suite outputs before Pi starts,
  then pass only exact mount paths and approved operation grants into the
  worker-local runtime configuration.

## Then: host proxy and lifecycle

- [x] Implement a generic Pi proxy holding only approved descriptor metadata and
  a guest-runner handle; it never imports suite code.
- [x] Register only guest-described, approved operations in the worker Pi
  subprocess that owns the VM; a real Pi worker-session smoke passed.
- [x] Acquire immutable suite outputs and describe operations before starting
  that worker Pi; a full `worker.mjs` smoke passed.
- [x] Release VM state through worker lifecycle cleanup; terminating a real
  Armory worker left no QEMU process behind.
- [x] Remove legacy Env package-cache, guest package/native installer, and
  snapshot-provisioning paths. Crew executes only immutable Nix guest suites;
  their dead implementation tests were removed with the code.

## Acceptance proof

- [x] Run two GitHub-enabled workers through a real Crew SDK launch; both
  received prepared Armory configuration and shared the same guest suite root.
- [x] Prove isolated Pi sessions and VMs/COW workspaces; guest credential
  injection supplies host-held secrets only as Gondolin placeholders.
- [x] Prove only immutable selected Nix paths are shared (two workers resolved
  the same suite root and exact closure path set).
- [x] Prove guest GitHub invocation uses the Nix closure rather than host `gh`
  (a host-PATH `gh` trap was not called); worker proxy imports only generic
  runner/runtime modules, not Armory suite implementation.
- [x] Test filtered-store denial for unrelated paths, traversal, readdir,
  `stat`/`access`, and symlink/realpath escape; worker-to-worker and Main
  session proxy isolation passed.
## Follow-up diagnostics

- [x] Narrow operation grants per assignment. Each `tools` grant names an
  exact Armory suite and operations; reserved suite `system` narrows native
  role tools. Direct suite grants avoid reverse-searching operation ownership.
- [x] Per-worker credential leases: the raw variable is removed before Pi starts, the worker
  receives an in-memory lease bound to allowed hosts, revoked on exit. (Renewal and rotation: plan item 13.)
- [x] Lifecycle and Comm servers shut down on `SIGTERM`/`SIGINT` and when their Main owner dies
  (`parent-watch.mjs`, covered by unit tests; a real `start_crew` owner-death run is plan item 9).
- Resolved (plan item 14): the ~4.8 s GitHub guest `describe` path. Cached Nix realization
  (~188 ms) and filtered VM creation (~43 ms) are not the startup bottleneck.
- Resolved: a failed launch archives worker evidence before rollback (`preserveEvidence`). Leadless-audit worker event logs.
  The first audit run had two failed agents (7/14/2 and 8/21/1
  turns/tool-calls/errors) but removal discarded detailed failure evidence.
- Resolved by live runs (plan item 10): a canonical `start_crew` two-worker integration. It must prove
  guest proxy registration, shared immutable closure identity, distinct
  workspaces, Main isolation, and normal plus owner-death teardown.

## Deferred

- Historical unresolved item (canonical plan): Add Terraform through the same flake/runner/proxy contract after GitHub
  acceptance is complete.

- [x] Investigate Gondolin layering/checkpoints; see
  `gondolin-overlay-investigation.md`.
- Historical unresolved item (canonical plan): Snapshot/profile-cache optimization after the base Nix-mount vertical slice.
