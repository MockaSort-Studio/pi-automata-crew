# Armory and Env lifecycle

## Ownership

Crew selects policy. Env builds and runs guest suites. Pi remains the host
subagent runtime. Armory suite code never runs in host Pi.

| Component      | Owns                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| Crew           | `actor.tools`, role/roster policy, dispatch narrowing                               |
| Armory         | suite catalog, co-located locked Nix flake, operation policy                        |
| Nix            | suite source/dependency resolution, immutable outputs, artifact cache               |
| Env            | guest build/mount, VM lifecycle, guest runner invocation, workspace/network/secrets |
| Host Pi worker | model session and generic per-session operation proxies                             |
| Guest suite    | operation implementation, dependencies, native tools, typed runner                  |

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
granted to that worker.

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

## Catalog cache

The last validated release catalog is stored under `~/.cache/pi-crew/armory-catalog/` as `latest.json` and
per-revision files. Operations use the canonical home path, whose ancestors up to the filesystem root must be real,
owned by root or the current user and not group- or world-writable. From home through the cache every directory must
be current-user-owned and not group- or world-writable; missing cache directories are created with mode 0700. Cache files are
opened without following symlinks and checked for ownership and permissions. Writes use mode 0600, exclusive random
temporary names and atomic rename. Platforms without user IDs or no-follow support disable caching. Unsafe or
unreadable cache directories and invalid cache files are ignored.

The cache is local input, not an authenticated release. Shape validation does not authenticate the source bundle hash
that the catalog supplies; checking a downloaded bundle against that hash cannot establish its origin. An attacker
operating as the same account can change these paths and is outside this boundary. Node does not provide an openat
chain here, so directory checks are not a guarantee against same-account pathname swaps. The policy protects against
other accounts exploiting shared or mis-permissioned cache locations, not a compromised account.

The latest catalog is retried on transport failure within a total 12-second fetch budget and may fall back to the cached latest; launch and doctor report
its revision and timestamp as potentially stale. A cached latest catalog is used only if it was fetched within the last
30 days (and not in the future); an older one is refused with an error naming its revision and timestamp, and the
launch needs the network again. A cached pinned revision is immutable and is used at any age. Successfully received malformed or invalid payloads are rejected,
not replaced with cached data. Canonical pinned release URLs use only their matching revision cache and a downloaded
revision must match the requested one. Other explicit URLs never fall back to latest or populate the cache. Cache writes
are best effort and cannot fail a launch.

## Extension source cache

A suite's extension source bundle is cached under `~/.cache/pi-crew/armory-src/<sha256>/` with exactly the same
directory, file and write rules as the catalog cache. A cached file is used only if its size and SHA-256 match the
catalog's pin; otherwise it is downloaded from the release URL built from the revision and file name, and verified
again. The host never imports the cached path: the verified bytes are written from memory, with an exclusive create,
into a fresh private `mkdtemp` directory (mode 0700) and that copy is imported and then removed, so swapping the cache
file after verification, or planting a symlink at a temporary name, cannot change the loaded code. Another account
cannot reach the copy; the same account (or root) can, which is the same residual as above: code running as the user
can already replace the extension itself.
