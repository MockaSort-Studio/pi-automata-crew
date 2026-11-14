# Architecture

How a Crew runs today. The earlier Comm/Lifecycle runtime was removed; its design notes are kept in
`docs/history/`.

## Shape

```mermaid
flowchart LR
  Main["Pi (Main)\nstart_crew, crew_* tools, footer"] -- "JSON lines over stdio" --> Host["crew host\n(one process per Main)"]
  Host --> D["dispatcher\nordering, hold, cancel"]
  D --> A1["member: Pi session\n(createAgentSession)"]
  D --> A2["member: Pi session"]
  A1 -- "routed tools" --> V1["Gondolin VM 1\nprivate workspace"]
  A2 -- "routed tools" --> V2["Gondolin VM 2"]
  A1 -- "host-side suite tools" --> S["Armory GitHub suite\n(host credentials)"]
  S -- "reads/writes the workspace" --> V1
```

- **Main** validates and assembles a crew (roles, personas, tool grants: unchanged), then sends one `launch`
  command. Results, state changes and live counters come back as events and `status` answers.
- **The crew host** is a separate process so a crash in a member or a `/reload` of Main cannot take the
  other down. It exits when Main's stdin closes, closing every VM first. A guardian process removes VMs if
  the host itself is killed.
- **Each member** is a real Pi session. Its built-in tools keep Pi's logic and run on the host, but their
  operations execute inside the member's own VM. Raw shell is granted per role.
- **Armory tools** (typed Git, pull requests) run on the host as Pi extensions loaded from a verified
  Armory source artifact. They act on the member's workspace through the host's view of it. Host credentials
  never enter the VM, whose network is deny-by-default.

## Dashboard

The Automata tab shows each member's turns, tool calls, errors, input and output tokens, cache reads and
writes, and context usage as a percentage of the model window. The context cell also shows the model window;
unknown values appear as dashes. The dashboard also has a Plan tab.

## Outcomes

The runner decides, from the session's messages and facts it recorded itself:

| Outcome       | When                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `completed`   | The last assistant message stopped normally with non-empty text, and, if it opened a pull request, CI is green |
| `needs_input` | The member called `request_input`; the same session continues on the answer                                    |
| `failed`      | A provider error (a fixed category), an empty turn, an abort or other stop                                     |
| `cancelled`   | Main cancelled it; the guest process group is killed                                                           |

### Member lifecycle

`runner/member-lifecycle.mjs` defines it. Each member has exactly one current `state`: `queued`, `held` (a
prerequisite is not complete), `running`, `ci`, `needs_input`, `failed`, `on_hold`, `completed`, `handed_off` or
`cancelled`. Only `completed` releases dependents, and it means the model finished and the CI gate passed or found
no checks: it is not review approval or acceptance.

Main decides what happens to a member that waits for it (`needs_input`, `failed` or `on_hold`):

- **`crew_message`** resumes it with exactly one turn. Every message resumes; the runner never judges prose.
- **`crew_hold`** records a blocker, its owner, a resume condition and optional PR/head/artifact references.
  The references are Main-asserted (`refsAssertedBy: "main"`): recorded as Main gave them, never verified by
  the runner. The member becomes `on_hold`, keeps its VM, and starts no turn; nothing polls or expires. A
  message resumes it.
- **`crew_handoff`** ends it as `partial` or `superseded` work with its unmet criteria and saved evidence (pull
  request, pushed head, last CI snapshot, salvage). Its VM is released; its node stays blocked, so dependents
  never start on it. A later message recovers it in a new session given its assignment and the handoff. The
  new session carries the runner-recorded pull request and push evidence of the old one (never model or Main
  text), so the CI gate verifies that pull request's current head before the member can complete; the handoff's
  CI snapshot is history, never a green result.
- **`crew_cancel`** ends it; its node fails and its VM is released. Cancelling the crew also fails the nodes of
  members that never started, even those held behind a prerequisite.
  A cancel during agent creation starts no model turn; the abort reaches the running prompt and a CI follow-up
  through their signal.

A dependent already running when its completed prerequisite is reopened (a follow-up) started on the earlier
result: if the prerequisite then fails, asks a question or is cancelled, the dependent keeps running and ends as
itself.

When every member has settled, Main is told once per settling. A member reporting `running` again (Main's
answer, a retry, a follow-up) re-arms the notice, so a crew that settles again after a resume is reported again:
after a "waiting for input" notice, answering until the crew completes brings the terminal notice. Main gets a
turn only if a member still waits for its answer (`needs_input` or `failed`) or the crew finished; a crew whose
blocked members are on hold, handed off or held behind one of those is reported without a turn (a cancelled
member's node is failed, not blocked). The dashboard shows those members as blocked. A run's notice bookkeeping
is dropped when the run is cleaned up or the host exits.

Holds and handoffs are recorded in the run's `events.jsonl` as `decision` events and are not delivered as
reports. `crew_status` shows, beside the state, `lastReport` (the latest report's status and time, `current`
only while the member is still in that state), `ci` (state, `pullNumber`, `headSha`, `checkedAt`, `rounds`, `checks` as name and conclusion pairs, and `current`
until the member works again; only `success` is green, `none` and `unavailable` are not), and the current `hold`
or `handoff`. Main's text in a hold or handoff is recorded whole or refused, never shortened.

### The CI gate

A member that opened a pull request is not `completed` when it stops talking, but when CI says so. The runner
reads the pull request and the last pushed commit from the run's evidence (what the tools returned, never what
the model said) and asks the Armory's `github_pull_request_checks_wait` to wait for that commit's checks. While it
waits the member's state is `ci`.

- **Green:** the member completes and the result carries the checks.
- **Red:** the same session is resumed with each failing check and its log tail, so the member fixes the cause
  and pushes. After five attempts the member becomes `needs_input` instead of looping.
- **No CI, a closed pull request, or CI that cannot be checked:** reported as such; the last two ask Main.
- **Green but the checks were weakened:** if the pull request touches the files that define them (workflows,
  formatter and linter ignore lists and configs, test-runner configs) the member asks Main, and once Main
  replies those files are accepted for that member. This exists because a member told to make CI pass once did
  exactly that by adding its file to `.prettierignore`.
- **Cancel** ends the wait.

A member that fails or asks a question is **held** with its dependents, not terminal. Only a cancel or a handoff
ends it.
When a run ends, salvage is best-effort for members granted typed Git commit and push: the runner attempts to
commit and push uncommitted work to the member's `crew/<run>/<member>` branch. Salvage failure is reported
beside the result. Salvage runs after the CI gate; if it commits or pushes on a completed member that is
held to CI, the gate runs again on the new head before anything depends on it (at most twice; then the member asks
Main and its CI snapshot is not current). Dependents are never released on an unverified head.

## Trust and limits

- A VM is fail-closed: no host fallback.
- A member can call exactly the tools its role and roster entry declare. The host registers the tools a crew
  needs from the Armory and Crew inspects no tool input; what a call can reach is bounded by the host's
  credential. Git operations are pure JavaScript and run no hooks.
- **Pull requests:** developer roles declare tools to create, list, read and update PRs, and not to comment,
  review or merge; reviewers, Main and humans handle review and landing.
- Tokens are never written to files, logs or transcripts; failures report fixed categories.
- No automatic time limits. Cancel and manual intervention instead.

## Known limits

- A crew does not survive its host: if the host dies, running members are gone (their pushed branches are
  not).
- One host per Pi. Several Pis on one machine each run their own.
