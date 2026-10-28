# Recovered issues to dispatch — transcript

Scope: conversation from **“Recovered issues — Crew core only”** through the
resulting implementation-Crew dispatch. This records a selection/planning gap
for later analysis; it is not a design specification.

## Recovered Crew-core issues

Assistant recovered these relevant issues:

1. RPC workers acknowledge a delivery before its Pi turn settles, so a later
delivery can replace reply context and make `comm_reply` fail.
2. Durable run records can remain `started` after workers are cleaned up.
3. Internal observers receive adapter projections rather than raw Comm
envelopes, preventing dependency-ledger observation.
4. The controller is at the file-size ceiling and needs a separate seam before
ledger work.
5. Dependency waiting/release is still prompt convention; no DAG/state ledger
or end-to-end dependency test exists.
6. RPC observability lacks complete bounded operational metrics.

## Initial, flawed party proposal

Assistant proposed a no-Lead party of an architect, developer, and advisor.
The stated rationale was independent boundary design and failure review.

User objected: this is corrective implementation work, so developers—not a
ceremonial mix of roles—are needed.

Assistant accepted the correction and proposed developers only, but initially
picked Snowball and Tomashco. User objected again: persona selection was not
grounded in the actual catalog/domain. Snowball is the Hall-infrastructure
fit; Frontenzo is the relevant TypeScript/TUI fit for later UI work.

## Corrected selection rule

User established the intended sequence:

```text
goal
→ small independent tasks with dependencies
→ required role authority
→ strongest persona/domain fit
→ allow repeated persona-role pairs
→ ordinal handles
```

Party diversity is not a goal. The smallest party that covers independent work
is the goal. If Snowball is the best Hall-infrastructure profile, use multiple
Snowballs rather than inventing persona diversity.

## Corrected implementation party

No Lead is selected. Main broadcasts the kickoff and receives direct reports.

```text
developer-snowball-00  RPC delivery/reply-context repair
developer-snowball-01  raw-envelope observer seam
developer-snowball-02  terminal lifecycle/observability repair
```

## Dependency correction

User pointed out that the initial multiple-Snowball proposal omitted
dependencies. The corrected graph is:

```text
snowball-00 ─┐
snowball-01 ─┼→ Main integration and full validation
snowball-02 ─┘
```

The three bounded mutations are parallel. Main integration depends on all
three. The future dependency-ledger patch depends on the raw-envelope seam and
reliable RPC delivery.

The selected-crew manifest must record bounded tasks and `dependsOn` even while
Main remains the manual integration barrier. This conversation exposed gaps in
task decomposition, persona/role selection, and Crew planning. Analyse and
improve those mechanisms after the core repair.
