---
name: engineering-execution
description: Plan and dispatch a bounded engineering change through a Crew, then integrate and verify its results. Use when the user asks to implement or dispatch engineering work.
---

# Engineering execution

This is a scaffold for Main or the user, not worker prompt content.

1. **Plan.** Identify the objective, affected paths, acceptance criteria and tests. Call `crew_route` on
   the paths and use its personas; if routing is missing or wrong, correct `SPECIALIST_ROUTES` and route
   again. Select roles separately. Give developers disjoint files or chain overlapping work with
   `dependsOn`. Present the plan and obtain approval unless already authorized.
2. **Prepare assignments.** Supply each member's scope, criteria, required tests, recipient, and evidence
   up front: repository and full remote revision, relevant files or PR, and any decisions already made.
   Explicitly grant the tools and operations needed to inspect that evidence, run tests, and deliver the
   result. Verify grants and evidence access before launch; never assume omitted tools default to a role.
   Set only authorized repository and branch operations. A worker's role and persona provide its discipline.
3. **Launch and wait.** Use `start_crew`; it dispatches immediately in dependency order. End your turn and
   wait for messages rather than polling. A blocked member stays held until you have the requested evidence
   or a decision; do not resume it merely to ask it to wait or repeat its question. Respond using
   `crew_message` only when you can unblock it; cancel when appropriate.
4. **Integrate and review.** Verify reports against branches, PRs and tests, integrate on a scratch branch,
   and run the relevant suite and format check. Dispatch independent reviewers together per related batch,
   using changed-path routing. A green check alone is never sufficient to merge: evaluate the diff, review
   verdicts, unresolved findings and acceptance evidence. Resolve blockers and rerun affected checks.
5. **Finish.** Use `runtime_cleanup` when work is complete, preserve needed evidence, and report outcomes,
   checks and residual risks. Crew work goes through review and a pull request, not directly to `main`.
