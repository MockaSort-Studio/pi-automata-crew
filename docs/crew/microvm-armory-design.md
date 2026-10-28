# MicroVM + Armory design

## Decision

Crew remains a host-side orchestration layer over Pi subagent subprocesses.
Pi RPC, Comm, model sessions, and Crew lifecycle remain host-side. Armory suite
code and native tooling execute in a private Gondolin guest for each worker.
There is no guest Pi and no guest Pi RPC.

```text
Crew -> host Pi worker session -> generic Env proxy -> private guest VM
                                                    -> guest suite runner
                                                    -> suite tools/binaries
```

The host proxy is trusted control-plane code. Armory artifacts are untrusted
execution-plane code and are never imported as host Pi extensions.

## Three planes

| Plane | Contains | Must not contain |
| --- | --- | --- |
| Crew policy | role/roster grants, task, dependency plan | binaries, suite implementation |
| Host Pi control plane | Pi subagent, generic proxy, operation schemas | Armory module code, Nix paths, native tools, guest secrets |
| Guest Env execution plane | suite runner, extension implementation, dependencies, native tools, workspace | Pi process/session/RPC, another worker's data |

Pi must know a selected tool's name, description, and input schema so the model
can call it. That metadata is the only suite information allowed in host Pi.
The generic proxy has one behavior for every operation: validate input, invoke
the worker's Env lease, and return the structured guest result. It never
imports suite code or executes a command.

## Profile source of truth

Crew assembles `actor.tools` from `roles.json` and `roster.json`:

```text
role baseline tools + automaton additions - dispatch narrowing
```

The final set is fixed for that worker lifetime. Crew classifies it as:

| Class | Example | Location |
| --- | --- | --- |
| Crew internal | `comm_notify` | host Crew/Comm |
| Pi built-in | `read`, `bash`, `edit` | generic Env routing to guest |
| Armory operation | `github_issue_view` | generic Pi proxy to guest suite runner |

Env resolves approved Armory operations to suites before the worker Pi session
starts. It builds the guest, asks the guest suite runner for operation
descriptors, and supplies only the approved descriptors to that worker's
proxy. `pi.registerTool()` is process/session-local: selected Armory tools do
not appear in Main Pi or another Crew worker.

## Nix is the sole Env materializer and artifact cache

Env has one materialization interface and one suite-artifact cache: Nix.

```text
locked suite flake + locked dependency inputs
  -> guest extension bundle/runner + JS dependencies + native closures
  -> immutable paths in /nix/store
  -> read-only mounts in selected worker VMs
```

Nix may use ecosystem tooling internally to realize locked JavaScript
dependencies. Env never runs npm/pnpm, maintains no package cache, and does
not copy suite archives into guest root disks. The normal host Pi npm workflow
is separate and does not materialize Armory guest artifacts.

### Filtered-store isolation invariant

A worker never receives a host `/nix/store` mount. It receives one read-only
virtual `/nix/store` provider whose immutable allowlist is the exact recursive
closure of that worker's selected physical profile. Every provider operation
(`open`, `stat`, `lstat`, `readdir`, `access`, `readlink`, and `realpath`) must
reject a first store-path component outside that allowlist as generic `ENOENT`.
It must normalize and reject traversal before delegation. Nix symlinks may
resolve only through the same filtered provider; they must not escape to a
host path.

The provider is created separately for each worker VM. Immutable backing bytes
may be shared in host Nix, but no guest sees another worker's workspace,
credentials, writable overlay, unselected suite entries, or host store
inventory. Main Pi has no worker VM, runner, or Armory proxy registration.
The worker model has only registered metadata/proxies and guest-routed builtin
tools; it has no host shell, Nix CLI, suite module import, VM handle, or
credential value. The host runtime itself remains trusted control-plane code.

A suite flake exposes a standard guest-suite output. It contains the complete
guest dependency graph and a generic runner contract: describe approved
operations and invoke one typed operation. The current GitHub flake proves the
native `gh` closure only; it must grow into this complete guest-suite output.

## Guest layers and isolation

The small Gondolin root remains generic. Env mounts exact Nix store paths
read-only, never `/nix` wholesale:

```text
small root + exact suite store paths + private COW disk + private workspace
```

Every worker gets its own QEMU process, VM overlay, workspace, and live
credentials. Multiple workers may mount the same immutable Nix paths. Cache
bytes are shared; capabilities are not: only selected paths and only selected
Pi proxies are attached to a worker.

A physical profile is platform + base version + canonical selected suite output
identities. An authorization profile is the worker's approved operation set.
They are deliberately different: workers may share a physical suite layer but
receive different operation projections.

Snapshots are deferred. Nix-store reuse is sufficient for the first vertical
slice. A later snapshot may cache only mutable root preparation state and a
sidecar of Nix identities; it must never cache workspaces, credentials, or
live sessions.

## Invocation

```text
agent calls named Pi tool
  -> host generic proxy
  -> Env lease invokes guest runner
  -> guest suite implementation invokes guest native tools
  -> typed result returns through proxy to Pi
```

The runner is not Pi. It accepts typed invocation data through Env and returns
structured results. Network and credentials are controlled by Gondolin at
execution time; they never enter Nix outputs or reusable VM state.

## Evidence

Pi Node 24 + Gondolin 0.12 prove checkpoint/resume and private COW on Linux
x86. A locked Nix `gh` closure (9 paths, roughly 84 MiB) runs at its exact
`/nix/store/.../bin/gh` path when those paths are mounted read-only in a guest.
The guest root has roughly 79 MiB free, so closures cannot be copied into it.

## Delivery plan

1. Standardize the suite flake's complete guest-suite output and runner
   descriptor/invocation protocol.
2. Build GitHub extension code, its locked dependencies, and `gh` in that
   output; retain no Env npm/package cache.
3. Have Env build the selected suite flake, enumerate exact store paths, and
   mount them in the private worker VM before starting Pi.
4. Add the generic worker proxy that registers only guest-described, approved
   operations into that worker Pi session and forwards calls through Env.
5. Prove two Crew workers have distinct session tools/VM overlays while sharing
   immutable Nix paths; prove no host `gh` or Armory implementation executes.
6. Add Terraform through the same flake/runner/proxy contract.
