---
name: engineering-execution
description: Run a bounded engineering change through a Crew, from plan to integrated, verified and disbanded. Use when the user asks to implement, build, fix or dispatch work with the Crew, not when merely discussing Crews.
---

# Engineering execution

1. **Plan once.** Objective, members, each member's files and acceptance criteria, dependencies. One
   developer per disjoint file set; if two members need the same file, chain them with `dependsOn`.
   Derive affected paths and call `crew_route`; it selects specialist personas from `.pi/crew/SPECIALIST_ROUTES`.
   Main still selects roles. Show the plan as a short table and proceed on the user's go
   (or immediately if they already approved).
2. **Assign.** For each member give: objective, files in scope, acceptance criteria, tests required,
   recipient of the report. Worker discipline (branch `crew/<handle>`, no push, scoped tests, report
   shape) is already in the developer role; do not repeat it.
3. **Launch** with `start_crew`. Developers get `read grep find ls bash edit write`; reviewers and
   advisors stay read-only. Use `environment.microvm: "none"` when workers must commit (git metadata is
   not usable inside a guest). Then call `runtime_dispatch` for the root tasks. Kickoff is automatic:
   do not send another.
4. **Wait.** End your turn. Reports arrive as messages; acknowledge each. Do not poll or sleep in a loop.
5. **Integrate.** Merge the `crew/*` branches on a scratch branch, run `npm test` and the format check,
   resolve conflicts, and open a pull request. Never push Crew output straight to `main`.
6. **Review** the diff with the `engineering-review` skill; fix findings (back to step 1 if sizeable).
7. **Disband** with `runtime_cleanup`, delete merged `crew/*` branches, and report what happened, truthfully,
   from tool results. Preserve worker output before any cleanup or retry.
