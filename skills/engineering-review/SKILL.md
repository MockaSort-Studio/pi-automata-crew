---
name: engineering-review
description: Dispatch independent specialist review of a change against its acceptance criteria and relevant boundaries. Use when the user asks to review a change or completed iteration.
---

# Engineering review

This is a dispatch scaffold for Main or the user. Reviewers must not review their own work.

1. Gather the base revision, changed paths and diff, acceptance criteria, test results and PR reference.
   Call `crew_route` on changed paths and select independent reviewers for the returned domains. Security
   review is triggered when changed paths route to Bollo, not required for every change. Do not select an
   author as reviewer.
2. Launch one review crew with several independent reviewers for each related batch, not a separate crew
   per reviewer. Give each reviewer a bounded domain, explicit criteria, relevant files and evidence up
   front, a recipient, and appropriate review authority. Include the PR and revision so they can inspect
   the same change. `deliverTo` is lowercase `main` or a member handle (`Main` is rejected). Optional `requiredCapabilities` (`[{ suite, operations }]`) asserts authorization only: `start_crew` refuses a member whose grants or role ceiling lack it, but a grant does not guarantee runtime tools or installed dependencies. An optional `inputs` entry `{ kind: "autonomy", allowedFileClasses: ["tests"], forbiddenFiles: ["src/secret/**"] }` (exactly those two keys, kind exactly `autonomy`, one per member) is scope guidance the member must obey, enforced by nothing in the runtime and granting no authority. Members granted bash find verified read-only dependency sources and Prettier under `/opt/crew/dependency-sources` (`docs/crew/verification.md`).
3. Before `start_crew`, validate explicit tool grants and evidence access for every reviewer: reading the
   workspace or PR, inspecting checks and review threads, running focused tests, and submitting a review
   if authorized. Never assume omitted tools default to a role. If access is unavailable, obtain it or
   record a blocked review rather than launching an unequipped reviewer.
4. Wait for reports without polling. Hold a blocked member without resuming it until you have evidence or
   a decision that answers its question. Collect one verdict per reviewer, with file/line evidence,
   severity, checks and residual risk. Send fixes back to developers and review the resulting changes.
5. Never merge on a green check alone. Inspect the diff, acceptance evidence, independent verdicts and
   unresolved findings; a missing review or evidence is not approval.
