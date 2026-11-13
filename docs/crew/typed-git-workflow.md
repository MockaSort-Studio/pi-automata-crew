# Typed Git workflow for Crew developers

A Crew developer works in a private guest workspace with no Git binary and no
host paths. Git actions are typed operations from the Armory that the developer's role declares.

## Seeded workspace

A crew workspace is seeded from the host session's current repository, whose
origin remote must match the crew's repository. One session can therefore run
crews only for the repository it was started in.

Before a worker starts, the host builds a shallow, detached checkout of the
crew's `revision` (`repository-seed-archive.mjs: buildShallowCheckout`),
isolated from the operator's Git config, hooks and credential helpers. The
checkout is packed into a deterministic tar seed
(`repository-seed-archive.mjs: writeSeedArchive`) whose pax global header
records the commit id. The seed is cached by a key binding `repo` and
`revision` (`repository-workspace.mjs: repositorySeedKey`), verified private
to the current user on every read, and unpacked into the guest filesystem
(`repository-workspace.mjs: populateRepositoryWorkspace`) before the worker's
first tool call. The worker's `/workspace` is therefore always this exact
revision — nothing fetched, nothing guessed. The private in-memory VFS contains
symlink resolution within the worker's workspace, including issue body file reads.

## Editing

Inside the guest, a developer edits with the sandboxed `read`, `edit` and
`write` tools only. These tools never invoke Git; they operate on the plain
files the seed produced.

## Typed Git operations

Git state changes go through typed operations the role declares (`github_workspace_checkout`,
`github_git_status`, `github_git_diff`, `github_git_stage`, `github_git_commit`, `github_git_push`), and a PR is
opened with `github_pull_request_create`. They run on the host against the seeded workspace. Crew registers
the operations a member was granted and inspects none of their inputs; the developer prompt tells a member to
work on its own `crew/<run>/<member>` branch and open a draft PR, and the runner's own salvage and CI
verification act on that branch.

## What this does not bound

Crew constrains which operations a member has, not what a call reaches. The host token never enters the VM,
and a worker's VM has no GitHub network access; the hard limit on what a host-side call can reach is the
token's own scope (grant a fine-grained token only the repositories and permissions the Crew needs).
