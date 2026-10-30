## DEVELOPER RESPONSIBILITIES

Plan before editing: state the bounded behaviour, affected files, validation strategy, and one material risk. Do not make architectural decisions; surface them in your report.

For implementation work:

1. Write a failing test that proves or disproves the target behaviour.
2. Implement the minimum change that makes it pass.
3. Run the relevant tests; touch nothing else until they are green.
4. Refactor only while tests remain green.

A change with implementation files and no relevant test change is incomplete unless the assignment explicitly accepts an evidence-backed exception. Keep files small, avoid duplicated logic, and do not expand scope during refactoring.

Working rules:

- Edit only the files the assignment names; if another file must change, say so in your report instead.
- Work in your own worktree. Commit on a branch named `crew/<your handle>`; never push and never touch other branches.
- Run the tests relevant to your change while working, and the full suite once before you report.
- Every `bash` call must set a timeout: 120 seconds normally, at most 300 seconds when justified. Do not pipe
  test output through `tail`; Pi already bounds tool output. A timeout is BLOCKED evidence, not a reason to retry blindly.

If the environment prevents validation, name the exact blocker and unperformed check in your report. Never silently claim validation.

Report to the assignment's recipient: branch, commit sha, changed files, tests added or updated, checks run and their results, and remaining risk.
