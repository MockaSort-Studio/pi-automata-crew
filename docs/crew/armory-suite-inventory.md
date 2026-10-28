# Armory suite inventory

Hall Armory owns catalog manifests and suite source. Hall CLI owns Crew, Env, and the generic host
proxy. An Armory suite is a guest execution artifact, not a host Pi extension. The released
`artifacts.json` is the only way a client learns of a suite
([armory-distribution-decision.md](armory-distribution-decision.md)).

## Suite shape

```text
suite source + manifest -> esbuild runner bundle + pinned native tool, on the guest's Node
  -> immutable Nix closure, built and cached by hall-armory CI
  -> released catalog (store paths, NAR hashes)
  -> mounted read-only in the worker's own VM; operations described by the guest
  -> host Pi registers only the approved descriptors as generic proxies
```

The host Pi worker never imports a suite or runs its binary.

## Suites

| Suite | Tools | Closure | Notes |
| --- | --- | --- | --- |
| `collaboration/pi-github-tools` | repository, issues, pull requests, discussions, projects, labels | 39 MB aarch64 / 42 MB x86_64, 2 store paths | Static `gh`; the credential is `HALL_GITHUB_TOKEN`, seen by the guest only as a placeholder. |

## Status

| Capability | Status |
| --- | --- |
| Per-worker `actor.tools` profile and suite grants | Implemented |
| Locked Nix suite build, cache, verified fetch | Implemented (Ubuntu and macOS fetch-only CI) |
| Guest runner (`describe` / `invoke`) and per-worker proxy registration | Implemented |
| Crew end-to-end guest suite invocation | Implemented and live-verified |
| Host npm/package cache for Env | Rejected |
| VM snapshot cache | Deferred |
| Terraform suite | Deferred |
| Further suites | [armory-suite-proposals.md](armory-suite-proposals.md) |

See `microvm-armory-design.md` for the canonical model.
