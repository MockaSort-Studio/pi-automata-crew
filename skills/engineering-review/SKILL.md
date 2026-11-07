---
name: engineering-review
description: Independently review a change against its acceptance criteria, including runtime and security boundaries when relevant. Use when asked to review a change or completed iteration.
---

# Engineering review

Review only work you did not author. Treat acceptance criteria as falsifiable claims.

1. Get the diff and changed paths with `git diff --name-only <base>...HEAD` and the diff stat.
2. Call `crew_route` with the changed paths. It selects personas from `SPECIALIST_ROUTES`;
   never select the author. Reviewers get read-only tools (`read grep find ls bash`). Supply
   the relevant procedure explicitly; workers do not discover project skills.
3. Launch reviewers in parallel with `start_crew` (it dispatches immediately), then wait for
   messages without polling. Summarize one verdict per reviewer with blocking findings.
   Reviewers never edit; fixes go back through the engineering execution process.
4. Inspect the diff, changed files, focused tests, and nearest contract tests. Identify observable
   behavior and try to falsify each claim with a focused test or command. Prefer behavioral tests;
   verify each test would regress if the protected behavior were removed.
5. Examine failure paths, concurrency, maintainability, and security as appropriate. Verify grants
   are least-privilege and explicit, including operations, network hosts, credentials, and bash.

## Independent runtime review lens

For Pi Crew runtime, Armory, Gondolin, Comm, lifecycle, or role changes, inspect:

- worker launch failure and cleanup/roster terminalization;
- Comm/Lifecycle authorization and owner-death behavior;
- guest mount, network, credential, and host-fallback boundaries;
- bounded logs and absence of secret values in artifacts.

## Verdict

Report evidence-backed findings with file/line, impact, severity and minimal requested change. State checks run and residual risk. Return `APPROVE` only without blocking or major findings, `REQUEST_CHANGES` for those findings, or `BLOCKED` when required code, evidence, access or execution is unavailable. Do not edit, merge, or repair the reviewed work.
