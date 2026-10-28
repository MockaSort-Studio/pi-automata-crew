# Armory suite distribution: decision record

Status: decided 2026-10-03. Revisit triggers are listed at the end.

## Problem

A Crew worker runs in a Linux Gondolin VM whose CPU architecture matches the
host (QEMU only accelerates a matching guest). Armory suites are therefore Linux
closures: `x86_64-linux` (Linux, Intel Macs) and `aarch64-linux` (Apple silicon).
A Mac cannot build them (no Linux builder), and evaluating the suite flake
downloads nixpkgs (about 1 GB of store). Distribution must be cross-OS, fast,
and light, and a missing artifact must degrade to a host-only Crew, never fail.

## Scope principle

Armory ships the lightest closure that makes a tool functional, relative to the
guest baseline (Alpine/musl, Node 24, `sh`, `curl`, pinned by the Gondolin
version). What the tool does at runtime (workspaces, downloads, caches, network)
is the tool's and the guest policy's concern, not distribution's. Suites are
sized by what the guest lacks, nothing more.

## Options considered

| Option | Verdict |
| --- | --- |
| **A. Nix on the client, CI-built Linux closures in a Cachix binary cache** | **Chosen** |
| B. CI-built closure tarballs (sha256 in the catalog), no Nix on the client | Deferred; clean second step |
| C. FlakeHub Cache | Rejected: paid plans only; pulling needs `determinate-nixd login` |
| D. Local Linux builder on every Mac | Rejected: sudo setup, GBs of disk, slow first build |
| E. Host-only Crews | Kept as the automatic fallback, not the product |

## Why Nix won (A)

- It is the mechanism already built and tested: catalog resolves a channel to an
  immutable revision, suites are flake outputs, closures are exact store paths
  mounted read-only through the filtered `/nix/store` provider.
- The suite flake is pinned, so output paths are identical on every machine. CI
  builds once per system; clients substitute and never build (about 30 s CI
  builds, and no client builder).
- Nix deduplicates shared closure pieces (node, gh) across suites and fetches
  only missing paths. Tarballs would re-ship them per suite.
- Signature and key verification come from Nix; B would make us own that trust
  model (catalog hashes and attestations).
- A local build remains possible when an artifact is missing or a suite author is
  iterating, which B cannot offer.
- The user accepted one-time client setup in exchange for the above.

## Cost of A, stated plainly

- Each machine needs Nix and one cache entry, which needs root once.
- This install's `trusted-users` is only `root`, so a client cannot add a
  substituter per call. The cache must be in `extra-substituters` and
  `extra-trusted-public-keys`.
- Pulling the first time costs a download of the runtime closure only (build
  tools are not fetched). Closure size is still to be measured.
- Windows has no native Nix. Windows hosts take the host fallback (WSL2 is fine).

## Bootstrap options researched

| Option | Result |
| --- | --- |
| Determinate installer | One command, needs root (creates the `/nix` volume on macOS). Chosen. |
| `nix-portable` | Rootless and zero-config, but Linux only; explicitly no macOS support. Possible rootless fallback on Linux; not validated with this repo. |
| FlakeHub Cache | Already trusted by Determinate installs, but paid and needs login. Rejected. |
| Per-call `--option extra-substituters` | Ignored for untrusted users. Making the user trusted is effectively root equivalence; rejected. |
| Run Nix inside a Gondolin guest | Would remove host Nix, but is unvalidated (guest Nix availability, network policy, persisting the store to the host). A spike, not a plan. |
| Tarball artifacts (B) | Removes Nix from the client entirely; see revisit triggers. |

macOS cannot avoid one elevated step: the `/nix` volume requires root. The
practical minimum is therefore one command and one password prompt, which
`scripts/setup-env.sh` provides: it installs Nix if missing, adds the Armory
cache to `/etc/nix/nix.custom.conf`, restarts the daemon, and verifies. It never
runs implicitly; the Crew only reports it (preflight message, host fallback).

## Assessment: Nix inside a Gondolin guest

Not an anti-pattern: a Linux VM running Nix to realize Linux closures is how
macOS Nix already works (`darwin.linux-builder`, Determinate's native Linux
builder). Our variant would only fetch from the cache into a host directory,
never build, so the host needs no Nix, no root, and no client config (we are
root inside the VM and set the substituters there).

It is probably overkill for us. It trades a one-time install for a permanent
moving part: a guest image with a static Nix, guest network policy for the cache
hosts, a writable host mount that preserves symlinks, executable bits, and the
Nix database, a VM boot on every cache miss, and harder debugging. Tarballs
(option B) remove Nix from the client with less machinery and need only a CI
export step plus catalog fields. Choose Nix-in-a-guest only if we want to keep
Nix semantics (deduplication, signatures, local builds) without a host install,
and then after a measured spike, not before.

## Artifact catalog (implemented)

One immutable document, `artifacts.json`, is attached to a GitHub Release of
hall-armory. It holds the git revision, the pinned cache identity, every suite
manifest verbatim, and per suite and guest system the exact store path, `narHash`
and full closure list.

- **Release gate.** `publish-artifacts.yml` runs after a green `main` run, builds
  the document with local builds forbidden (`--max-jobs 0`), and creates the
  release `armory-<sha>` only if every artifact is fetchable from the cache.
  Unchanged suites publish nothing. A revision therefore becomes visible only
  when complete, so a client never asks the cache for a path that is not there.
  This is the structural fix for the daemon's cached-miss problem.
- **Channel.** Clients read `releases/latest/download/artifacts.json`: no API, no
  rate limit, no Nix. A worker re-fetches the exact tag it was launched with, so
  it cannot drift to a newer release.
- **Fetch.** The client runs `nix copy --from <cache> <storePath>`, which asks the
  cache directly and bypasses the daemon's miss cache, then checks the installed
  closure and every `narHash` against the document, then roots it.
- **Trust.** The client refuses a catalog that names a cache other than the one
  pinned in `armory-cache.json`; Nix still verifies signatures against the keys
  configured by `scripts/setup-env.sh`. Enable immutable releases in the
  repository settings so a published catalog cannot be altered. A build
  provenance attestation is a possible later hardening.
- **One entrypoint.** The release is the only source of Armory suites. There is
  no second path through the repository's flake: an unreachable or invalid
  release, a suite it does not carry for this system, or a closure that fails
  verification all make the Crew fall back to host-only workers (`auto`) or
  report the error (explicit `gondolin`), with the reason. A suite under
  development is exercised by publishing a release, not by pointing a client at
  a branch.
- **Opacity.** The host never loads suite code. Bundling the extension into
  `runner.mjs` does not change the contract: the worker proxy registers only
  operations the guest `armory-suite` executable describes and approves, and
  invokes them through it. The same source (`githubOperationDescriptors`) still
  backs the static Pi extension, so both modes share one implementation.

Measured from a true cold start (Apple silicon): 0.7 s to resolve the release,
9 s to fetch, +38 MB in the store, in total 10 s, against 3 min and about 690 MB
by evaluating the flake. The closure survives a garbage collection.

## Credentials

The GitHub suite's `gh` refuses to run without a token, even for public data. The
host-owned policy (`credential-policy.mjs`) binds the guest's `GITHUB_TOKEN` to the
host variable `HALL_GITHUB_TOKEN`. The variable is Hall-specific on purpose: a
`GITHUB_TOKEN` exported for other tools is never handed to workers by accident.

Hall never reads a `gh` login or keyring on its own. The token is minted
deliberately and handed over through the environment:

- **Mint:** a fine-grained token at
  https://github.com/settings/personal-access-tokens/new, limited to the
  repositories a Crew needs (read access to Issues, Pull requests, Contents and
  Metadata unless workers must write). Reusing the `gh` login is possible with
  `scripts/setup-github-token.sh --from-gh`, but that token carries the full access
  of the login.
- **Store:** `scripts/setup-github-token.sh` verifies the token with GitHub (and
  names a broad classic token's scopes), writes `export HALL_GITHUB_TOKEN=...` to
  `~/.config/hall/env` with mode 600, and adds one guarded `source` line to the
  shell profile. Start Pi from a shell that has it.
- **Missing:** the Crew still starts; the launch result and the roster's
  `environmentResolution` carry a warning with the link and the script, and
  `github_*` calls fail at call time with `gh`'s auth message until it is set.

The worker parent leases the value in memory and removes it from its environment
before Pi starts; the guest sees only a placeholder that Gondolin substitutes at
`api.github.com` and `github.com`. Only presence, never a value, is recorded. Known
property: Pi's own environment holds the variable, so tools the Main agent runs
inherit it; capturing and deleting it at extension load would close that.

## Cache policy

- Only CI pushes (hall-armory `packages.yml`, per affected suite, after tests,
  `main` only). Pull requests build without credentials or upload.
- The token should live in a GitHub Environment restricted to `main`, so a
  writer's branch cannot use it to publish artifacts clients would trust.
- Warming is unnecessary for correctness: pinned store paths never change.
  Run `cache-sync.yml` manually after cache cleanup or a retention change.
- Cache: `https://hall-armory.cachix.org`, key
  `hall-armory.cachix.org-1:xKu3F2f2lHnVSl9gyFi5Fsk2rs724sILlfdEIHWjWrc=`.

## Measurements (2026-10-03, Apple silicon, `aarch64-linux` guest)

- CI: each system builds in about 30 s. The fetch-only verify (`--max-jobs 0`)
  passes on Ubuntu and on a macOS runner, so Macs substitute without a builder.
- Slim closure (hall-armory PR #3): the GitHub suite is the esbuild runner
  bundle plus the upstream static `gh` (sha256-pinned), run on the guest's own
  Node. Closure: 39 MB on aarch64 and 42 MB on x86_64, 2 paths, down from 352 MB
  and 67 paths. CI checks it on both architectures: size and forbidden-runtime
  guard, and `describe` plus `gh --version` inside `node:24-alpine`.
- Local test (Apple silicon): the cached closure mounted through the project's
  filtered store layer into a real Gondolin guest ran `describe` and `gh`; only
  the 2 closure paths were visible.
- Cold start, measured separately. Fetching the closure from the cache with
  `nix copy`, no evaluation: 9 s, +37 MB. Flake evaluation (`nix build` of the
  `github:` locator) with the closure already local: 44 s, +330 MB of nixpkgs
  source. Evaluation is now about 80% of the time and 90% of the bytes of a cold
  start and is not needed to run the suite. The earlier 352 MB closure plus the
  341 MB nixpkgs source gave the 848 MB peak seen before the slimming.
- Client, warm: 1.4 s. Each closure is rooted by `--out-link` under
  `~/.cache/hall/armory/roots/<suite>-<system>` (a newer revision overwrites
  the link). The link must be created in place; moving it unregisters the root.
- Known behaviour: substitution queries go through the Nix daemon, which caches a
  miss for an hour. A client that looked up a revision before CI pushed it keeps
  planning a local build (and fetching build inputs) until that entry expires,
  and the daemon's cache is root-owned. `nix copy --from <cache> <path>` bypasses
  it. This is one more reason to resolve published store paths instead of
  evaluating.
- Building instead would need the same runtime plus build tools (a CI verify log
  showed 126 paths, 260 MiB download and 802 MiB unpacked) and a compile.

## Revisit triggers (move to B, tarballs)

- Several suites make duplicated downloads or disk use material.
- Install friction blocks adoption, or Windows-native hosts matter.
- Cachix retention or limits become a recurring operational cost.

B is additive: CI keeps `nix build`, adds a deterministic closure export, and the
client points the filtered-store provider at an extracted directory (its backend
is already injectable). Nix would remain as the dev and fallback path.
