---
name: post-iteration-review
description: Consistent end-of-iteration review of a Pi Crew change for over-engineering, dead code or tests, weak spots, and vulnerabilities. Use after every development iteration, before it is called done.
allowed-tools: read grep find ls bash
---

# Post-iteration review

Run on the iteration's diff (`git diff <base>...HEAD`) by someone who did not write it.
Always report all four sections, even when empty, so reviews stay comparable.

1. **Over-engineering.** Abstractions, options, layers, or files with a single caller or no
   requirement behind them; code solving a case no test or requirement names; files over
   ~200 lines. Ask: what is the smallest change that meets the stated requirement?
2. **Dead code and tests.** Exports with no consumer (`rg` each new/changed export), unused
   parameters, stale docs/comments, skipped or duplicated tests, and tests that assert only
   source text or mocks instead of behavior. For each test, name the change that would make it fail;
   if none, it is dead.
3. **Weak spots.** Unhandled failure paths, races, unbounded output or retries, state that
   survives a crash or owner death, error messages that hide the cause, behavior documented
   but not enforced.
4. **Vulnerabilities.** Apply `security-boundary-review`: grants, credentials, network,
   isolation, supply chain.

Each finding: file/line, why it matters, minimal fix, severity (blocking/major/minor).
Finish with `APPROVE`, `REQUEST_CHANGES` or `BLOCKED` and the commands run. Do not edit the work.
