# Typed Git workflow for Crew developers

A Crew developer works in a private guest workspace with no Git binary and no
host paths. Git actions are typed guest operations, authorized against one
repository, one revision, one base branch and one worker branch.

## Seeded workspace

Before a worker starts, the host builds a shallow, detached checkout of the
authorized `revision` (`repository-seed-archive.mjs: buildShallowCheckout`),
isolated from the operator's Git config, hooks and credential helpers. The
checkout is packed into a deterministic tar seed
(`repository-seed-archive.mjs: writeSeedArchive`) whose pax global header
records the commit id. The seed is cached by a key binding `repo` and
`revision` (`repository-workspace.mjs: repositorySeedKey`), verified private
to the current user on every read, and unpacked into the guest filesystem
(`repository-workspace.mjs: populateRepositoryWorkspace`) before the worker's
first tool call. The worker's `/workspace` is therefore always this exact
revision — nothing fetched, nothing guessed.

## Editing

Inside the guest, a developer edits with the sandboxed `read`, `edit` and
`write` tools only. These tools never invoke Git; they operate on the plain
files the seed produced.

## Typed Git operations

Git state changes go through six typed operations, each validated against the
worker's `repositoryAuthorization` (`repository-authorization.mjs`):

- `github_workspace_checkout` — creates/switches to the worker branch at the
  authorized `revision`; both must match the policy exactly.
- `github_git_status` — lists changed, staged and untracked files.
- `github_git_diff` — unified diff, optionally scoped to safe workspace-relative
  paths (no absolute paths, no `..`, no pathspec magic).
- `github_git_stage` — stages exactly the given paths.
- `github_git_commit` — commits staged changes; requires a non-empty message.
- `github_git_push` — fast-forward push to the worker branch only; any other
  branch is rejected.

Every call's `repo` must equal the authorized `repo`; no other key (sha,
force, remote, refspec) is accepted — `assertKnownShape` rejects unknown
fields before any field-level check runs.

## Opening the pull request

`github_pull_request_create` is the one allowed PR operation. Its `head` must
equal the worker branch and its `base` must equal the authorized base; any
other combination is refused.

## Authorization binding

`repositoryAuthorization` binds `repo`, `revision`, `base` and `branch` once,
from trusted Env policy, not from worker input. `authorizeRepositoryOperation`
re-checks every guarded call against that binding, so the typed operations can
only check out, diff, stage, commit, push and open a PR for the one repository,
revision, base and branch the worker was authorized for.

## What this does not bound

The authorization constrains the typed operations, not the guest. A worker
with `bash` can run its own code, and the guest's `GITHUB_TOKEN` placeholder is
substituted for any request to the suite's allowed GitHub hosts. The hard limits
are therefore the token's own scope (grant a fine-grained token only the
repositories and permissions the Crew needs) and the host allowlist.
