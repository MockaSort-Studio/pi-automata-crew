---
name: security-boundary-review
description: Dispatch independent review of security boundaries when changed paths route to the security specialist. Use for relevant grants, isolation, credentials or lifecycle changes.
---

# Security boundary review

For Main or the user: call `crew_route` on the changed paths. Dispatch Bollo when the routes select Bollo;
security review is not universally mandatory. Include the security reviewer in the same review crew as
other independent reviewers for the related batch, never an author of the reviewed work.

Supply the revision, diff, acceptance criteria, relevant grants and test evidence up front. Explicitly
validate each reviewer's tool grants and access to that evidence before launch; never rely on omitted
tools defaulting to a role. Ask for evidence on assets, principals, trust boundaries, deny-by-default,
least privilege, credentials, isolation and cleanup, as relevant to the change.

Wait without polling. Hold a blocked member until evidence or a decision answers its question. Require
findings with impact, location, evidence and residual risk; fix blockers and review the fixes. Never merge
on a green check alone: inspect the diff, independent verdicts and acceptance evidence.
