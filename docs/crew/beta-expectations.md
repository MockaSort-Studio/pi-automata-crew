# First beta expectations

This beta is for work that can be reviewed through the normal GitHub pull-request
flow. It isolates member work, records its lifecycle, and leaves review and
landing with people.

## What you can rely on

- Each member has its own VM-backed guest workspace. Its guest tool operations
  run there; there is no fallback to the host when a VM cannot start.
- The `HALL_GITHUB_TOKEN` used by typed GitHub operations stays on the host and
  never enters a member VM. Those operations run host-side against the member's
  workspace.
- If a member opens a pull request, it completes only after the runner has
  verified green CI for the pull request's current, exact head commit (or found
  no checks after its grace period). A red result resumes the same session with
  failed-check details; unavailable CI, closed PRs, or an unverifiable PR state
  require attention instead.
- A member that needs attention can be messaged to continue, held with a
  recorded blocker, handed off as partial or superseded work, or cancelled.
  Holding preserves its VM without starting a turn; handoff and cancellation
  release it. Only completed members release dependents.
- Member reports are delivered to Main as Pi messages, and the run records
  reported events under `.pi/runtime/crews/<run>/events.jsonl`.
- Cancellation ends the member and kills its guest process group. On Pi quit
  or host shutdown, the host closes every VM; a shutdown deadline bounds the
  host's wait before it exits.

## What to expect while working

- Developer work uses a `crew/<run>/<member>` branch and developers are
  instructed to open draft pull requests. Review, approval, merge, and landing
  remain work for reviewers, Main, or people.
- Format workspace files with the guest's supplied Prettier when it is
  available. Do not substitute a host formatter; if it is unavailable, ask for
  hosted CI or coordinator help.
- The hosted pull-request CI workflow is the supported runner for project
  tests whose dependencies are not present in a guest. Its required path runs
  the project tests and a separate format check.
- Tests that exercise live guests need a VM backend. CI selects QEMU; local
  hosts can use the bundled libkrun runner on supported platforms or QEMU.

## Known limits

- A crew does not survive its host process. Running members disappear with the
  host, but branches already pushed to GitHub remain available.
- There is one Crew host process per Pi session. Separate Pi sessions have
  separate hosts.
- A new workspace seed can be built only from the repository of the current Pi
  session: its `origin` must match the crew repository. A private cached seed
  for the same repository revision can be reused without checking the current
  origin.
- Crew grants operations but does not inspect their inputs. The host token's
  scope is therefore the bound on what granted GitHub calls can reach. Use a
  fine-grained token limited to one repository and only the permissions needed.
- Guests have no `git` binary and use deny-by-default networking. Use typed Git
  operations for Git state, and do not rely on fetching from a guest.
- Bundled libkrun support is for macOS arm64 and Linux x64. Other host setups
  use QEMU when it is installed and passes preflight.
- Linux libkrun is not covered by required CI. Required CI uses QEMU and
  temporarily excludes three Linux-krun cases under a guarded skip policy.

For lifecycle detail, see [architecture](architecture.md); for guest checks and
formatting, see [verification](verification.md); for the Linux-krun exception,
see [the CI skip policy](ci-skip-policy.md).
