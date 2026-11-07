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
  [Armory](https://github.com/MockaSort-Studio/hall-armory)) run on your host, against the exact repository,
  revision and `crew/<run>/<member>` branch the crew is authorized for. Pushing elsewhere, force pushes and
  other refs are refused.
- **Deterministic outcomes.** The runner, not the model, decides whether an agent completed, needs input
  or failed. A rate-limited or empty model turn is a failure with a category, never a silent success.
- **Best-effort salvage.** For members granted typed Git commit and push, the runner attempts to commit and push
  uncommitted work to the member's branch when a run ends. Salvage failure is reported beside the result.
- **Ordering and conversation.** `dependsOn` makes a member wait for another and receive its result. A member
  can ask you a question (`request_input`) and continues in the same session when you answer.
- **A TUI.** A footer line per active crew with live counts and tokens, and a dashboard
  (`/crew-dashboard`, `ctrl+shift+d`). Its Automata tab shows per-member turns, tool calls, errors,
  tokens, and context usage as a percentage of the model window; a Plan tab shows the plan.
- **Every run keeps a transcript** under `.pi/runtime/crews/<run>/`.

## Install

Requires Node 24, git and [Pi](https://pi.dev). Nix is **not** needed. A VM needs libkrun (macOS arm64 and
Linux x64 ship one) or QEMU.

```bash
pi install git:github.com/<org>/pi-automata-crew      # or: pi install /path/to/checkout
pi list
```

Then check the machine from inside Pi:

```text
/crew-doctor
```

It boots a VM and checks everything a crew depends on, and says what to fix. For GitHub tools, export
`HALL_GITHUB_TOKEN` (and have the `gh` CLI installed); crews that do not use GitHub run without it.

Use a fine-grained token limited to the one repository the crew works on, with read and write on contents, pull
requests and issues (plus metadata read). The token stays on your host and never enters a VM, and Crew policy only
lets a member use it on the authorized repository, its own branch and its own pull request, but the token's own scope
is the outer bound: keep it as narrow as the work needs.

## Use

Ask Pi to start a crew (it uses `start_crew`; `crew_route` picks specialists for paths). Name a `model` as
`provider/id` and, for repository work, pin `environment.repository.revision` to a full commit SHA that exists
on the remote. Everything that can be checked is checked before any VM starts.

Developers own their pull requests, which Crew opens as drafts. They can list and read pull requests in the
authorized repository, including files, checks and review threads, and update only their own PR's title, body,
open/closed state and labels. They cannot comment, request changes, approve, merge or mark a PR ready; review
and landing belong to reviewers, Main and humans.

| Tool                           | Use                                                          |
| ------------------------------ | ------------------------------------------------------------ |
| `start_crew`                   | Launch members; assignments dispatch immediately             |
| `crew_status`                  | Look at each member's state and last activity                |
| `crew_message`                 | Answer a question, retry a failed member, or follow up       |
| `crew_cancel`                  | Stop a member or the whole crew; running commands are killed |
| `runtime_cleanup`              | Dispose every crew from this session and close its VMs       |
| `crew_doctor` / `/crew-doctor` | Check this machine                                           |

There is no deadline on an agent run. A member that fails or asks a question is
held, not lost, until you message or cancel it. Quitting Pi closes every VM; `/reload` leaves running crews alone.

## Develop

```bash
npm ci
npm test                 # needs a VM; HALL_SKIP_GONDOLIN_LIVE_TESTS=1 skips those, as CI does
npm run format:check
```

Live tests run the real host, real VMs and an offline model.

## Layout

- `extensions/crew/runner/` — the crew host: dispatcher, member agents, routed tools, host-side suites.
- `extensions/crew/crew/` — assembly, roles, the TUI, and the Pi tools.
- `extensions/crew/env-runtime/` — Gondolin VMs, workspaces, guest network, credentials, doctor.
- `extensions/crew/crew-runtime/` — the earlier Comm/Lifecycle runtime, kept for the backend scale-up. Its
  extension entry point is not loaded; some modules are still used, including `lib/crew-terminal-notifier.mjs`.
- `skills/` and root `SPECIALIST_ROUTES` — Crew procedures and routing policy.
- `tests/crew/`, `tests/runtime/` — behavior tests; live ones use real VMs.
- `docs/crew/` — design notes and history. See [architecture](docs/crew/architecture.md).
