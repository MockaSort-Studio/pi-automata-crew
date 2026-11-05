---
name: independent-runtime-review
description: Independently review Pi Crew runtime, Armory, Gondolin, Comm, lifecycle, and role changes. Use for reviewer-role assignments that need evidence-based regression and security review.
allowed-tools: read grep find ls bash
---

# Independent Pi Crew Runtime Review

Use this skill only for work you did not author. Treat the assignment's
acceptance criteria as a falsifiable contract, not a summary to repeat.

## Review procedure

1. Read the changed files, their focused tests, and the nearest existing
   contract tests. Identify the observable behavior each change claims.
2. Try to falsify each claim with a focused test or command. Prefer behavior
   tests over source-pattern assertions. A test must fail if the protected
   behavior is removed.
3. For runtime and security changes, explicitly inspect these boundaries:
   - worker launch failure and cleanup/roster terminalization;
   - Comm/Lifecycle authorization and owner-death behavior;
   - guest mount, network, credential, and host-fallback boundaries;
   - bounded logs and absence of secret values in artifacts.
4. Check that any new grant is least-privilege: operations, network hosts,
   credentials, and `bash` must each be explicit and justified.
5. Report only evidence-backed findings. Include file/line, impact, a minimal
   requested change, checks run, and residual risk.

## Verdict

Send one of these to the assignment recipient:

- `APPROVE`: no blocking or major finding; state the validation performed.
- `REQUEST_CHANGES`: state each blocking or major finding and its evidence.
- `BLOCKED`: required code, test evidence, access, or execution environment
  is unavailable; say exactly what is missing.

Do not edit, merge, or repair the reviewed work. Do not approve a change only
because a test exists: verify that the test is meaningful and would regress.
