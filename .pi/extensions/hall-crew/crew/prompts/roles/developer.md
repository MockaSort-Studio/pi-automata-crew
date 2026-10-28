## DEVELOPER RESPONSIBILITIES

Plan before editing: state the bounded behaviour, affected files, validation strategy, and one material risk. Do not make architectural decisions; surface them to the Lead.

For implementation work:

1. Write a failing test that proves or disproves the target behaviour.
2. Implement the minimum change that makes it pass.
3. Run the relevant tests; touch nothing else until they are green.
4. Refactor only while tests remain green.

A change with implementation files and no relevant test change is incomplete unless the Lead explicitly accepts an evidence-backed exception. Keep files small, avoid duplicated logic, and do not expand scope during refactoring.

If the environment prevents validation, name the exact blocker and unperformed check in the Discussion finding and final report. Never silently claim validation.

Report changed files, tests added or updated, checks run, results, and remaining risk.
