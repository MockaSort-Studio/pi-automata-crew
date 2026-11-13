# Pi Automata Crew

A control plane for agents, inside [Pi](https://pi.dev). From Pi you dispatch role-based agents; each
one is a Pi session whose tools run inside its own isolated VM; results come back to you as messages,
and the work lands as pushed branches and draft pull requests that a human reviews.

```text
You ─ Pi ─ start_crew ─► crew host (one process per Pi)
                          ├─ developer-ada-00   Pi session ─► tools run in VM 1
                          └─ reviewer-bollo-00  Pi session ─► tools run in VM 2
                                    │ results, questions, failures
You ◄────────── messages ◄──────────┘
```

## What you get

- **Isolation by default.** Every agent's `bash`, `read`, `write`, `edit`, `grep`, `find` and `ls` run in
  its own [Gondolin](https://github.com/earendil-works/gondolin) VM with a private workspace and no
  network. There is no fallback to your host: if a VM cannot start, the launch fails and says why.
- **Credentials stay out of the VM.** GitHub tools (typed Git operations and pull requests, from the
  [Armory](https://github.com/MockaSort-Studio/hall-armory)) run on your host with a Crew token. A member can call
  exactly the operations its role and roster entry declare, and nothing else.
- **Deterministic outcomes.** The runner, not the model, decides whether an agent completed, needs input
  or failed. A rate-limited or empty model turn is a failure with a category, never a silent success.
- **Done means green CI.** A member that opens a pull request completes only when CI is green on the commit it
  pushed. The runner waits for the checks; if they are red it resumes the same session with the failing checks
  and their log tails, and after a few attempts it asks you. Changes to the files that define the checks
  (workflows, formatter and linter ignore lists, test-runner configs) are reported to you even when CI is green.
  This needs the repository to have CI; without it the result says so.
- **Best-effort salvage.** For members granted typed Git commit and push, the runner attempts to commit and push
  uncommitted work to the member's branch when a run ends. Salvage failure is reported beside the result.
- **Ordering and conversation.** `dependsOn` makes a member wait for another and receive its result. A member
  can ask you a question (`request_input`) and continues in the same session when you answer.
- **A TUI.** A footer line per active crew with live counts and tokens, and a dashboard
  (`/crew-dashboard`, `ctrl+shift+d`). Its Automata tab shows per-member turns, tool calls, errors,
  tokens, and context usage as a percentage of the model window; a Plan tab shows the plan.
- **Every run keeps a transcript** under `.pi/runtime/crews/<run>/`.

## Install

Requires Node 24, git and [Pi](https://pi.dev). Nix is **not** needed. Supported hosts follow
[Gondolin](https://github.com/earendil-works/gondolin): macOS arm64 and Linux x64 ship a libkrun runner; elsewhere
a VM needs QEMU.

```bash
pi install git:github.com/MockaSort-Studio/pi-automata-crew      # pin a release: ...pi-automata-crew@v0.1.0
pi install /path/to/checkout                                      # or a local checkout, for development
pi list
```

A published npm package (`npm:@mockasort-studio/pi-automata-crew`) follows the first release.

Then check the machine from inside Pi:

```text
/crew-doctor
```

It boots a VM and checks everything a crew depends on, and says what to fix. For GitHub tools, export
`HALL_GITHUB_TOKEN` (and have the `gh` CLI installed); crews that do not use GitHub run without it.

Use a fine-grained token limited to the one repository the crew works on, with read and write on contents, pull
requests and issues (plus metadata read). The token stays on your host and never enters a VM. Crew does not inspect a member's tool calls:
a member's declared tools decide what it may call, and the token's own scope decides what a call can reach, so keep it
as narrow as the work needs.

## Use

Ask Pi to start a crew (it uses `start_crew`; `crew_route` picks specialists for paths). Name a `model` as
`provider/id` and, for repository work, pin `environment.repository.revision` to a full commit SHA that exists
on the remote. Everything that can be checked is checked before any VM starts.

Developer roles declare pull request tools to create, list, read (files, checks, review threads) and update
pull requests, and not to comment, request changes, approve or merge; review and landing belong to reviewers, Main
and humans.

| Tool                           | Use                                                            |
| ------------------------------ | -------------------------------------------------------------- |
| `start_crew`                   | Launch members; assignments dispatch immediately               |
| `crew_status`                  | Look at each member's state (including `ci`) and last activity |
| `crew_message`                 | Resume a member: answer, retry, follow up, or recover          |
| `crew_hold`                    | Acknowledge a waiting member without a turn                    |
| `crew_handoff`                 | End a member as partial or superseded, without accepting it    |
| `crew_cancel`                  | Stop a member or the whole crew; running commands are killed   |
| `runtime_cleanup`              | Dispose every crew from this session and close its VMs         |
| `crew_doctor` / `/crew-doctor` | Check this machine                                             |

There is no deadline on an agent run. A member that fails or asks a question is
held, not lost, until you message, hold, hand off or cancel it. Quitting Pi closes every VM; `/reload` leaves running crews alone.

## License

GPL-3.0-only. See [LICENSE](LICENSE). Releases are described in [docs/crew/release.md](docs/crew/release.md) and
changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Develop

```bash
npm ci
npm test                 # needs a VM; CI boots the QEMU live tests and does not skip them
npm run format:check
```

Live tests run the real host, real VMs and an offline model. `HALL_SKIP_GONDOLIN_LIVE_TESTS=1` skips them on a
machine without a VM; CI never sets it, and a skip is not a pass.

Assignments accept `deliverTo` (lowercase `main` or a member handle; `Main` is rejected), `requiredCapabilities`
(`[{ suite, operations }]`: authorization is asserted before launch, but a grant does not guarantee installed tools),
and an optional `inputs` entry `{ "kind": "autonomy", "allowedFileClasses": [...], "forbiddenFiles": [...] }`
(only those keys; guidance for the member, not enforced by the runtime). Members granted bash see verified read-only
dependency sources and Prettier at `/opt/crew/dependency-sources` ([verification](docs/crew/verification.md)).

## Layout

- `extensions/crew/runner/` — the crew host: dispatcher, member agents, routed tools, host-side suites.
- `extensions/crew/crew/` — assembly, roles, the TUI, and the Pi tools.
- `extensions/crew/env-runtime/` — Gondolin VMs, workspaces, guest network, credentials, doctor.
- `extensions/crew/crew-runtime/` — the earlier Comm/Lifecycle runtime, kept for the backend scale-up. Its
  extension entry point is not loaded; some modules are still used, including `lib/crew-terminal-notifier.mjs`.
- `skills/` and root `SPECIALIST_ROUTES` — Crew procedures and routing policy.
- `tests/crew/`, `tests/runtime/` — behavior tests; live ones use real VMs.
- `docs/crew/` — design notes and history. See [architecture](docs/crew/architecture.md).
