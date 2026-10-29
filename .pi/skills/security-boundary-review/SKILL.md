---
name: security-boundary-review
description: Independently review Pi Crew security boundaries (grants, credentials, network egress, Gondolin isolation, lifecycle ownership, supply chain). Use for Bollo security-review assignments.
allowed-tools: read grep find ls bash
---

# Bollo security boundary review

Use this skill only to independently review work you did not author.

1. Identify assets, principals, authority grants, trust boundaries, and the
   attacker action each change makes possible.
2. Verify deny-by-default behavior with a behavioral test. Cover absent grants,
   invalid/stale identities, and one allowed path; source inspection alone is
   not evidence.
3. Verify secrets never enter worker config, logs, archives, prompts, or
   unscoped guest environments. Verify a credential cannot broaden a host or
   operation grant.
4. Verify isolation cleanup preserves bounded evidence and does not leave a
   process, VM, worktree, or reusable credential behind.
5. Report exploitability, affected boundary, evidence, and the smallest safe
   repair. Do not edit or approve your own work.

Return `APPROVE`, `REQUEST_CHANGES`, or `BLOCKED`, with residual risk and all
commands/tests run. A passing test that would also pass after removing the
security boundary is not sufficient evidence.
