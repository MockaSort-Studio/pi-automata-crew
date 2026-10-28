# Armory suite proposals and todo

Status: proposals, nothing built. A suite is a native binary run in the worker's own VM
([armory-suite-inventory.md](armory-suite-inventory.md)). Adding one needs no new mechanism for
typed tools: operation descriptors (name, description, schema, handler) plus a pinned binary,
released through the existing hall-armory pipeline.

## Two ways to expose a binary

| Exposure | The model sees | Cost per turn | Good for |
| --- | --- | --- | --- |
| **Typed tool** | a named operation, a schema, a compact result | its schema, about 130 tokens (641 measured for five), mostly cache reads | noisy or large output; roles with no shell; credential or network scope |
| **Binary on `PATH`** | nothing new; used through `bash` | none | small, model-filtered output (`jq`, `yq`) in roles that already have `bash` |

A typed tool that only forwards arguments to a binary adds its schema cost and gains nothing when
the role already has `bash`. It pays off when at least one of these holds:

1. **The raw output is large or noisy** and the tool returns a bounded summary. Only what a tool
   returns enters the model's context; `bash` passes everything through (up to Pi's own cap of 50 KB
   per call). Keep the full log in a workspace file so a failure can be read on demand.
2. **The role has no `bash`.** Grants are the only way to allow `act` and nothing else, or a linter
   without a shell. A reviewer is such a role.
3. **Scoped network or credentials**, which Gondolin enforces per suite.

## Measured

| Binary | Raw output through `bash` | Compact typed result |
| --- | --- | --- |
| `act`, this repo's `ci.yml` `validate` job | 10,939 chars, 173 lines, about 2,700 tokens, 48% of it repeated git warnings | step status lines, about 100 tokens |
| `prettier --check` on this repo | 3,231 chars for 57 failing files, about 800 tokens | a count and the first few paths |
| `jq`, `yq` | whatever filter the model writes; small | no gain |

So `act` and CI logs are clear typed-tool cases, `prettier` is borderline, and `jq`/`yq` are not.

## `act` inside the microVM

`act` has a host mode (`-P ubuntu-latest=-self-hosted`) that runs steps directly on the machine it is
on; here that is the worker's VM, which is already the isolation boundary. Containers inside it are
neither needed nor possible: the guest has no container runtime, no mounted cgroups and 86 MB free.
On libkrun with `act` 0.2.89 (19 MB static, linux/arm64): a three-step workflow succeeded, and this
repo's real `ci.yml` job `validate` passed in 3.9 s (56 + 10 + 5 checks).

Limits: the guest is Alpine with **musl and no glibc** (no `ld-linux`, no `libc.so.6`, no `gcompat`),
and steps run on Node 24, so a downloaded glibc binary (a toolchain from `setup-*`, a manylinux wheel)
will not run; Docker-based actions and `services:` containers cannot run; third-party `uses:` actions
need `github.com` allowed and were not tested; there are no secrets. A fast pre-push check, not a
replacement for CI.

## Target state

Roles get **complete suites and no `bash` by default**. `bash` becomes an explicit grant for a role
that needs it, not a baseline. What this buys: least privilege (a role can do exactly what it was
granted), compact results, no arbitrary code in a prompt-injected worker, and no wrong-flag mistakes.
What it costs is catalog completeness: a missing operation makes a worker report `blocked`, so each
step below removes `bash` only after the suites that replace it exist and the release path is cheap
enough to keep them complete.

## Todo

Status: `[x]` done, `[ ]` todo.

### Foundation (done)

- [x] GitHub suite: 38 typed tools over a static `gh`, 39 MB, scoped credential and hosts.
- [x] Released, hash-pinned catalog; verified fetch by store path (10 s cold); Ubuntu and macOS CI.
- [x] Per-role tool grants; the baseline profile has no `bash`, `edit` or `write`.
- [x] Measured: tool-schema cost, raw output sizes, `act` in the guest, guest egress, role tool sets.

### Suites

- [ ] **S1. CI run inspection** (typed; extends the GitHub suite). `github_workflow_runs_list`,
  `github_run_view`, `github_run_failed_log` (failed steps, bounded tail). No new closure; needs
  `actions:read`.
- [ ] **S2. `ci/workflow-lint`** (typed; actionlint, about 5 MB). `workflow_lint`, structured findings.
- [ ] **S3. `ci/workflow-run`** (typed; `act` in host mode, about 19 MB, size exception). `workflow_run`
  returns per-step status and a bounded failed-step tail, full log to a workspace file; drops the
  repeated git warnings. `workflow_list`.
- [ ] **S4. `dev/tasks`** (typed). `task_list` and `task_run(name)`: runs only tasks the project
  declares (`package.json` scripts, a task file), in the guest with network denied. One suite for any
  ecosystem, which is what lets a developer drop `bash`. Design risk to settle first: a worker with
  `edit` could rewrite a task and run it, so task definitions must come from the base commit or be
  approved, not read from the worktree.
- [ ] **S5. `dev/format`** (prettier, about 3 MB, bundled). First decide what `format:check` is for: it
  fails on 57 files and CI does not run it. Format once and enforce it, or drop the gate. Then build.
- [ ] **S6. `dev/yaml`** (`yq`) and **S7. `dev/json`** (`jq`). Typed or on `PATH` only on a
  demonstrated need; the guest has `node` and `python3` for JSON, and no YAML parser.
- [ ] **S8. `PATH` exposure** (`binaries` in the manifest) only if a suite is exposed that way.

### Network control

- [ ] **N1. Default-deny egress for every worker.** Measured: a default guest reaches the open web
  (200 from example.com); `allowedHosts` blocks it (403). The allowlist is the union of its suites'
  `allowedHosts`. Applies to `bash` too.
- [ ] **N2. A test** that a worker cannot reach a host outside its allowlist, with and without a
  credential (not measured with the credential attached; our code sets no global policy today).
- [ ] **N3. Open-web roles are an explicit grant** (a researcher, a web-fetch suite), never the default.
- [ ] **N4. Log denied requests** in worker events (host only), so a blocked step is diagnosable.

### `bash` policy

- [ ] **B1. Log the first word of each `bash` command** in worker events (never the arguments), to
  learn what roles actually run before deciding what to proxy.
- [ ] **B2. Drop `bash` from `reviewer`** (it has `bash` and no `edit`/`write`) once S1 to S4 exist.
- [ ] **B3. Trial a `bash`-less `developer` and `integrator`** with S4 and S5; keep `bash` as an
  explicit, per-assignment grant where the trial shows a gap.

### Hall Armory release (lowers the cost of keeping suites complete)

- [ ] **R1. Measure the release lead time**, from merged PR to a usable catalog (not measured today).
- [ ] **R2. A suite scaffold:** one command creating the directory, manifest, flake, size guard and
  guest-compat test, so a suite is not copied from the GitHub one.
- [ ] **R3. A local suite harness:** run a suite's `describe` and `invoke` in a Gondolin VM before
  opening a PR.
- [ ] **R4. Per-suite release:** a change to one suite should not rebuild or re-publish the others.
- [ ] **R5. A client check that the catalog's suites cover a role's grants**, so a missing operation
  fails at launch rather than as a `blocked` worker.

## Deferred or rejected, with the trigger

| Candidate | Decision | Reason or trigger |
| --- | --- | --- |
| TypeScript (`tsc`) | Defer | No `tsconfig` and no type-check gate here. Build when a repo adds one. |
| `rg` | Measure first | Pi's grep already runs through the VM filesystem. Count "command not found" bash turns in worker logs. |
| Workflow dispatch | Defer | A mutation. After S1 to S3 prove value, behind an explicit grant. |
| `git` in the guest | Reject | A worktree's `.git` points at a host path outside the mount; making it work breaks the isolation. |
| Project dependencies (`npm install`) | Reject | Project state, not a tool; the npm cache was rejected for Env on the same ground. |
| `shellcheck`, `yamllint` alone | Reject | actionlint covers workflow scripts and syntax. |
| Terraform | Defer | After the above, through the same contract. |

## Per-suite checklist

- A written trigger and a role that needs it.
- Closure of at most 10 MB unless justified, enforced by the existing CI size guard; pinned and
  hash-verified.
- Typed tools coarse, with bounded results and the full log kept in a file.
- Network and credential scope in the manifest, empty by default.
- Guest compatibility test on Alpine with Node 24 (musl), as for the GitHub suite.
