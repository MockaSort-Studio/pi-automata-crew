---
name: post-iteration-review
description: Dispatch an independent end-of-iteration review of complexity, dead code, weak spots and relevant vulnerabilities. Use before calling an iteration done.
---

# Post-iteration review

For Main or the user: gather the iteration diff, requirements and test evidence, then route its changed
paths with `crew_route`. Dispatch independent specialists together in one review crew for the related
batch. Include Bollo for security review when the paths route to Bollo, not as a universal requirement.

Supply each reviewer the revision, files, evidence, criteria and recipient up front. Explicitly validate
that the granted tools and operations can access that evidence and run the requested checks; never rely on
omitted tools defaulting to a role. Ask reviewers to assess complexity, dead code and tests, weak failure
paths, and relevant vulnerabilities, with evidence and actionable findings.

Set `deliverTo` to lowercase `main` or a member handle; optional `requiredCapabilities` and an `{ kind: "autonomy" }` input are described in `docs/crew/verification.md` and `docs/crew/architecture.md`.

Wait for reports without polling. Keep a blocked member held until you have evidence or a decision that
answers its question. Resolve blocking findings and verify the changed work independently. A green check
alone is not sufficient to merge; consider the diff, verdicts and acceptance evidence.
