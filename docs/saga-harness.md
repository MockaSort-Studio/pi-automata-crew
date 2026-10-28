# Saga harness

A Saga is the design contract for one development cycle. It lives in this repository under
`docs/saga/`; do not use a GitHub wiki. Write it only after the first four phases are confirmed.

## 1. Cycle framing

Establish all four before proceeding:

- **Cycle type:** `revision`, `new-feature`, or `new-product`.
- **Problem:** what is broken, missing, or being built, without solution language.
- **Affected actors:** named people or systems and their experience.
- **Success horizon:** an outcome, not an implementation promise.

## 2. Scope contract

Record concrete in-scope capabilities, explicit exclusions, dependencies, and risks. Stop if no
exclusions can be named: the scope is undefined.

## 3. Design

Do not propose an approach until scope is confirmed.

For each actor/action pair, record a concrete action and measurable success criterion. Then record:

- proposed approach and its tradeoffs;
- rejected alternatives and why;
- Mermaid diagrams for flows that prose cannot clearly describe (never ASCII art);
- only genuine unresolved blockers. Resolve ordinary research and technical judgment directly.

## 4. Verification criteria

Derive system-level proofs from the design. Each criterion is named, measurable, and states how it
is proven. These criteria drive OKR/KR work; a criterion that cannot be proven means the design is
not complete.

## 5. File and board

Create `docs/saga/Saga-N-<Name> [<tag>].md`. Valid tags are only `open`, `draft`, and `closed`.
Agents locate the active Saga by its `[open]` filename. Commit the document to `main`.

Create the matching repository milestone, `Saga N - <codename>`, before filing tracking issues.
Every Saga issue belongs to that milestone. The Project board is a view of those issues, not the
source of the design contract.

## Template

```md
_Saga type: <cycle-type>. Status: open. Filed: <YYYY-MM-DD>._
_Source issue: <link if available>_

---

## Design Doc

### Problem

<problem statement — no solution language>

**Affected:** <named actors and how they experience it>
**Success horizon:** <outcome-framed statement>

### Scope

**In scope:** <list>
**Out of scope:** <list>
**Dependencies:** <list or "none">
**Risks:** <list or "none">

### Use cases

| Actor | Action | Success criterion |
| --- | --- | --- |
| | | |

### System design

<approach and tradeoffs>

<Mermaid diagram(s), if needed>

<open points beside the decisions they affect>

### Verification criteria

| # | Criterion | How to prove |
| --- | --- | --- |
| 1 | | |

### Appendix

_Add lettered sections only for supporting material outside the main design._

---

## Plan

<!-- OKR-level only. Individual tasks belong on the board. -->

| # | OKR | Link | Status |
| --- | --- | --- | --- |
| 1 | | | open |

---

## Bug Fixes

_One entry per fix: **Title** — one-sentence description. ([#N](link))_
```
