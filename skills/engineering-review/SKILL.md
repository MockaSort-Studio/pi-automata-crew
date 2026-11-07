---
name: engineering-review
description: Independently review a change against its acceptance criteria, including runtime and security boundaries when relevant. Use when asked to review a change or completed iteration.
---

# Engineering review

Review only work you did not author. Treat acceptance criteria as falsifiable claims.

1. Inspect the diff, changed files, focused tests, and nearest contract tests. Identify observable behavior.
2. Try to falsify each claim with a focused test or command. Prefer behavioral tests; verify each test would regress if the protected behavior were removed.
3. For larger changes, route changed paths to independent reviewers with `crew_route`; persona selection does not replace review discipline. Supply the relevant procedure explicitly, since workers do not discover project skills. Wait for results without polling.
4. Examine failure paths, concurrency, maintainability, and security as appropriate. Verify grants are least-privilege and explicit, including operations, network hosts, credentials, and bash.

## Independent runtime review lens

For Pi Crew runtime, Armory, Gondolin, Comm, lifecycle, or role changes, inspect:

- worker launch failure and cleanup/roster terminalization;
- Comm/Lifecycle authorization and owner-death behavior;
- guest mount, network, credential, and host-fallback boundaries;
- bounded logs and absence of secret values in artifacts.

## Verdict

Report evidence-backed findings with file/line, impact, severity and minimal requested change. State checks run and residual risk. Return `APPROVE` only without blocking or major findings, `REQUEST_CHANGES` for those findings, or `BLOCKED` when required code, evidence, access or execution is unavailable. Do not edit, merge, or repair the reviewed work.
