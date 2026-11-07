---
name: engineering-execution
description: Run a bounded engineering change through a Crew, from plan to integrated, verified and disbanded. Use when the user asks to implement, build, fix or dispatch work with the Crew, not when merely discussing Crews.
---

# Engineering execution

1. **Plan once.** Objective, members, each member's files and acceptance criteria, dependencies. One
   developer per disjoint file set; if two members need the same file, chain them with `dependsOn`.
   Derive affected paths and call `crew_route`; it selects specialist personas from `SPECIALIST_ROUTES`.
   Main still selects roles, but **personas come only from `crew_route`**: use the specialists it returns
   for each member's paths and do not substitute others because they seem available or familiar (personas
   have real domains; see the roster). If a path matches no rule, or the persona looks wrong for it, fix
   `SPECIALIST_ROUTES` first (a test requires every tracked file to be routed) and route again. Show the plan as a short table and proceed on the user's go
   (or immediately if they already approved).
2. **Assign.** For each member give: objective, files in scope, acceptance criteria, tests required,
   recipient of the report. Worker discipline (check out the authorized branch first, push small
   checkpoints, the report shape, `request_input` for questions) is already in the developer role; do not
   repeat it. Pin `environment.repository.revision` to a full 40-character SHA that exists on the remote
   and name the `model` as `provider/id`; both are validated before anything starts.
3. **Launch** with `start_crew`. Developers get `read grep find ls bash edit write`; reviewers and
   advisors stay read-only; reviewers that must run tests also need `bash`. Every member runs in its own
   Gondolin VM; an unavailable guest environment is a launch failure to fix, never a host fallback.
   `start_crew` dispatches each assignment as soon as it launches, in dependency order: do not call
   `runtime_dispatch`.
4. **Wait.** End your turn. Each member's result arrives as a message; do not poll or sleep in a loop.
   A member that reported `needs_input` is waiting for your answer: send it with `crew_message`. A failed
   member's work is held, not lost: retry it with `crew_message` or end it with `crew_cancel`. Do not
   trust a report on its own; check the branch, the pull request and the tests it names.
5. **Integrate.** Merge the `crew/*` branches on a scratch branch, run `npm test` and the format check,
   resolve conflicts, and open a pull request. Never push Crew output straight to `main`.
6. **Review** the diff independently against the requirements and tests; check failures and security boundaries, report evidence-backed findings, and fix them (back to step 1 if sizeable).
7. **Disband** with `runtime_cleanup`, delete merged `crew/*` branches, and report what happened, truthfully,
   from tool results. A member's unsaved work is salvaged to its own `crew/*` branch whenever its run ends;
   look there before discarding anything.
