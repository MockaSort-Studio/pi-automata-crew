---
name: engineering-review
description: Review a change with independent specialists. Code review always, security when the diff touches sensitive paths, and a post-iteration check at the end of an iteration. Use when the user asks to review a change or an iteration is finished.
---

# Engineering review

1. **Get the diff.** `git diff --name-only <base>...HEAD` and the stat. For a small diff you may review it
   yourself with the lenses below instead of launching a Crew.
2. **Pick reviewers.** One or two specialists whose domains match the changed paths (`roster.json`),
   never the author. Reviewers get read-only tools (`read grep find ls bash`).
3. **Add Bollo** (security) if any changed path is security sensitive: `env-runtime/**`, Comm and
   Lifecycle code (`comm-*`, `lifecycle-*`), `worker*.mjs`, credential or network policy, `package.json`,
   the lockfile, `.github/workflows/**`. Edit this list as the repository changes.
4. **Lenses.** Each reviewer loads `independent-runtime-review`. Bollo also loads
   `security-boundary-review`. At the end of an iteration, `post-iteration-review` runs once over the
   whole diff.
5. **Launch** the reviewers in parallel with `start_crew` and `runtime_dispatch`, then wait for the
   messages (do not poll).
6. **Summarize** one verdict per reviewer with its blocking findings. Reviewers never edit; fixes go
   back through `engineering-execution`.
