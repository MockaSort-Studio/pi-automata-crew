# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/) once it is released.

## [Unreleased]

First release in preparation. What the Crew does today:

### Added

- `start_crew` launches role-based agents. Each is a Pi session whose built-in tools run in its own
  [Gondolin](https://github.com/earendil-works/gondolin) VM; there is no fallback to the host.
- GitHub tools (typed Git operations and pull requests) come from the
  [Armory](https://github.com/MockaSort-Studio/hall-armory) and run on the host: the credential never enters a VM.
  A member may push only to its own `crew/<run>/<member>` branch and change only its own pull request; pull
  requests are always opened as drafts.
- The runner decides outcomes (`completed`, `needs_input`, `failed`, `cancelled`), not the model. A member that
  opened a pull request completes only when CI is green on the commit it pushed; red CI resumes the same session
  with the failing checks, and changes to the files that define the checks are reported to Main.
- Dependencies between members (`dependsOn`), questions (`request_input`), follow-ups that reopen a completed
  member, cancel (kills the running commands), and best-effort salvage of unsaved work to the member's branch.
- Main's lifecycle decisions: `crew_hold` acknowledges a waiting member without a turn (blocker, owner, resume
  condition, optional PR/head/artifact), and `crew_handoff` ends one as partial or superseded work with its unmet
  criteria and saved evidence, releasing its VM but never its dependents. `crew_status` shows one current state,
  the latest report with its time, and the latest CI snapshot of an exact head; `none` and `unavailable` checks
  are never green, and `completed` is not review or acceptance.
- Specialist routing from `SPECIALIST_ROUTES` (`crew_route`): which persona works on which path.
- A TUI: a footer line per active crew and a dashboard (`/crew-dashboard`) with live turns, tools, errors,
  tokens, context usage and compactions.
- `/crew-doctor` checks that a machine can run a Crew (it boots a VM).
- Skills for dispatching and review: `engineering-execution`, `engineering-review`, `post-iteration-review`,
  `security-boundary-review`.
- Members granted bash get verified, read-only dependency sources and Prettier at `/opt/crew/dependency-sources`
  (SRI-checked public npm artifacts) so they can format in the guest.
- `requiredCapabilities` on a member asserts authorization (suite and operations) before launch.
- An optional `{ kind: "autonomy", allowedFileClasses, forbiddenFiles }` input gives a member scope guidance, and
  the Crew contract tells every member what always needs Main's answer. Unknown keys, a kind that only matches
  `autonomy` case-insensitively, and backticks or control characters in patterns are rejected.

### Known limits

- A crew does not survive its host process; pushed branches do.
- One host per Pi. Supported hosts follow Gondolin: macOS arm64 and Linux x64 (QEMU elsewhere).
- Reviewing and landing pull requests belong to reviewers, Main and humans.
