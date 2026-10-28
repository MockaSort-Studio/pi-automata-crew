# Armory and Env lifecycle

## Ownership

Crew selects policy. Env builds and runs guest suites. Pi remains the host
subagent runtime. Armory suite code never runs in host Pi.

| Component | Owns |
| --- | --- |
| Crew | `actor.tools`, role/roster policy, dispatch narrowing |
| Armory | suite catalog, co-located locked Nix flake, operation policy |
| Nix | suite source/dependency resolution, immutable outputs, artifact cache |
| Env | guest build/mount, VM lifecycle, guest runner invocation, workspace/network/secrets |
| Host Pi worker | model session and generic per-session operation proxies |
| Guest suite | operation implementation, dependencies, native tools, typed runner |

No Env npm install, package cache, archive fallback, or copied guest toolchain
exists. Nix is the one materializer and cache for Armory guest artifacts.

## Fixed worker preparation

```text
Crew assembles actor.tools
  -> derive fixed authorization profile
  -> Env resolves suites and allowed operations
  -> Nix builds each suite's locked guest output into /nix/store
  -> Env creates private VM and mounts exact output closure paths read-only
  -> Env asks guest runner to describe approved operations
  -> worker Pi starts with generic proxy extension and descriptors
  -> proxy registers selected tools in this Pi session only
```

The Pi process starts after the guest is ready. It never imports the Armory
suite package. Its proxy closures contain only operation metadata and a lease
handle; every call enters the guest.

## Session-local tool registration

`pi.registerTool()` is local to one worker subprocess. The generic proxy
registers only descriptors that are both supplied by the guest suite and
allowed by that worker authorization profile.

```text
reviewer session: github_pull_request_view
builder session: terraform_plan
Main session: neither
```

Named schemas/descriptions must be visible to host Pi for model tool calling.
That metadata is control-plane data, not permission to execute suite code on
the host. If host Pi knew no operation metadata, the only alternative would be
one untyped generic invocation tool.

## Guest suite contract

A suite flake's standard output includes:

```text
guest runner + extension implementation + locked dependencies + native closures
```

It supports two Env-invoked operations:

```text
describe(approved operations) -> operation descriptors
invoke(operation, typed input) -> structured result/error
```

The runner is a regular guest program, not a guest Pi process. The host generic
proxy transports typed requests through the Env lease. A native dependency,
such as `gh`, is resolved only inside this suite output and invoked only by the
guest implementation.

## Reuse and isolation

Nix store paths are immutable and shared. Env mounts only the selected exact
paths into each VM, never the host's whole `/nix` store. Workers receive fresh
QEMU processes, COW overlays, workspaces, and runtime credentials.

```text
authorization profile = permitted operation names
physical profile = platform + base + selected Nix output identities
```

The first implementation uses only Nix-store reuse. VM snapshots are deferred.
If introduced later, a snapshot caches mutable root preparation only and pins
Nix output identities in a sidecar. It never contains a workspace, credential,
or live worker state.

## Credentials and network

Gondolin injects credentials only into live guest network execution. Nix source
inputs, outputs, Nix store paths, worker profiles, and future snapshots contain
no credentials.

## GitHub vertical slice

1. Build a Nix guest output containing GitHub implementation/runner and `gh`.
2. Mount its exact closure paths in one worker VM.
3. Describe selected GitHub operations from that guest.
4. Register generic proxies only in that worker Pi session.
5. Invoke one operation through proxy -> guest runner -> guest `gh`.
6. Prove a second worker has a separate VM/session projection and shares only
   immutable Nix store paths.
