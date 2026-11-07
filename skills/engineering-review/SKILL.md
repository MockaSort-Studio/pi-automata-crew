---
name: engineering-review
description: Review a change with independent specialists. Code review always, security when the diff touches sensitive paths, and a post-iteration check at the end of an iteration. Use when the user asks to review a change or an iteration is finished.
---

# Engineering review

1. **Get the diff.** `git diff --name-only <base>...HEAD` and the stat. For a small diff you may review it
   yourself with the lenses below instead of launching a Crew.
2. **Pick reviewers.** Call `crew_route` with the changed paths. It selects personas from
   `SPECIALIST_ROUTES`, including Bollo on security-sensitive paths; never select an author.
   Reviewers get read-only tools (`read grep find ls bash`).
3. **Keep routing in one place.** Update `SPECIALIST_ROUTES`, not this skill, when security-sensitive
   path coverage changes.
4. **Lenses.** Put `independent-runtime-review` in each reviewer's `skills` assignment. Bollo also
   receives `security-boundary-review`. At the end of an iteration, one reviewer receives
   `post-iteration-review` for the whole diff. The procedures are embedded during assembly; workers do
   not discover project skills.
5. **Launch** the reviewers in parallel with `start_crew` (it dispatches immediately), then wait for the
   messages (do not poll).
6. **Summarize** one verdict per reviewer with its blocking findings. Reviewers never edit; fixes go
   back through `engineering-execution`.
