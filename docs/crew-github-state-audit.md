# GitHub State-Management Audit

**Snapshot:** 2026-08-31 at commit `71cc01303da9ba23dabba5277bbd931ac110d2f6`  
**Scope:** `.pi/extensions/github`, the signed Crew Discussion wrappers, live Saga 2, and KR [#358](https://github.com/MockaSort-Studio/hall-of-automata-cli/issues/358).  
**Discussion:** [#395](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395). Deleted solo Discussion #393 is not evidence.

## Verdict

The current extensions are sufficient for the narrow KR #358 Crew research/fact-checking proof: they produced one canonical Discussion with roster-aware signed-format posts while Fabric mesh carried lifecycle and exchange pointers. They are **not** a workflow-complete general GitHub continuity layer.

Use a split gate:

1. **Accept KR #358** once its final Discussion close cites this artifact.
2. **Do not advertise general Phase 3 state-management completeness** until issue state mutation, Project item identity, list/output contracts, inverse operations, and Discussion trust/destructive controls are hardened.

“Signed” below means formatted cooperative attribution. It is not cryptographic or actor-bound authentication.

## Current workflow requirement

The live Saga 2 design makes GitHub the durable, developer-visible continuity layer and mesh the lifecycle/control channel. Its KR #358 contract requires a lead plus specialists to demonstrate recruit, watch, review, and close; a specialist exchange through the run-scoped topic; a human-visible Discussion mirror; and a separately written artifact. It does not require this run to close an Issue or mutate a Project field.

## Capability audit

### Issues

Public registration: `.pi/extensions/github/index.ts:32-36,72-83`. Implementation: `.pi/extensions/github/lib/issues/index.ts:5-18,48-74`.

| Operation | Current behavior | Fitness |
|---|---|---|
| List | `github_issues_list` supports state, labels, milestone, and an explicit limit; returns parsed JSON. | Fit for bounded reads. |
| View | `github_issue_view` returns number, title, body, labels, milestone, state, and URL. | Fit. |
| Create | `github_issue_create` requires `bodyFile`, with optional labels and milestone; returns URL and parsed number. | Fit, but file-backed body is a deliberate contract constraint and retries can duplicate. |
| Update | `github_issue_update` accepts title, body, milestone, or arbitrary state text. Truthy fields cannot be cleared. | **State is broken:** `open`/`closed` emits `gh issue edit --state`, absent from installed `gh 2.97.0`; other state strings are silently omitted while other edits proceed. |
| Comment | `github_issue_comment` posts inline text and returns an acknowledgement, not the comment URL. | Fit for this run; retry is non-idempotent. |

The adapter must use the CLI's close/reopen commands or another supported API for state. The current schema must also reject unsupported state values and empty updates.

### Labels

Public registration: `.pi/extensions/github/index.ts:59-70,84-86`. Implementation: `.pi/extensions/github/lib/labels/index.ts:3-34` and `.pi/extensions/github/lib/issues/index.ts:76-79`.

| Operation | Current behavior | Fitness |
|---|---|---|
| Add to Issue | Batch add through comma-joined `gh issue edit --add-label`; rereads the Issue. | Fit; empty arrays are not schema-rejected. |
| Remove from Issue | Removes one named label and rereads the Issue. | Fit. |
| List repository labels | Returns name, color, and description. | Description says “all,” but no limit is passed; current CLI default caps the result. |
| Create | Calls `gh label create --force`. | Operationally an upsert, not strict create; useful retry behavior with surprising overwrite semantics. |
| Update | Supports color and/or description. | Schema permits neither field, leaving a CLI-level no-op/error. No rename or delete tool exists. |

### Dependencies

Public registration: `.pi/extensions/github/index.ts:42-44,75-77`. Implementation: `.pi/extensions/github/lib/issues/index.ts:38-56,82-84`.

- `github_dependency_add` resolves the blocking Issue database ID and POSTs it to `dependencies/blocked_by`.
- `github_dependency_list` reads `blocked_by` and parses one REST response page.
- No remove operation, pagination contract, or normalized “already present” result exists.

This is adequate for small live dependency reads such as #358 → #357, but an edge alone does not mean the blocker remains unsatisfied; #357 is closed.

### Subissues

Public registration: `.pi/extensions/github/index.ts:37-41`. Implementation: `.pi/extensions/github/lib/issues/index.ts:21-34,82-84`.

- `github_subissue_add` resolves the child database ID and POSTs it to `sub_issues`.
- `github_subissues_list` emits raw `--jq '.[] | {number, title}'` text, not a stable array. Its shape varies by cardinality: empty string, one serialized object, or newline-separated objects.
- No detach operation or normalized retry result exists.

The operations exist, but the list contract is not dependable for programmatic consumers.

### Projects v2

Public registration: `.pi/extensions/github/index.ts:46-55`. Implementation: `.pi/extensions/github/lib/projects/index.ts:4-48`.

| Operation | Current behavior | Fitness |
|---|---|---|
| Fields/options | `github_project_fields` resolves current field and single-select option IDs live. | Avoids stale local mirrors; field-list uses the CLI default cap. |
| Item add | `github_project_item_add` adds an Issue/PR URL. | Exists; returns raw JSON text and has no normalized retry semantics. |
| Item find | `github_project_item_find` scans at most 500 items and matches only `content.number`. | **Unsafe identity:** repository and content type are ignored, so same-number Issues/PRs can collide; truncation is indistinguishable from absence. |
| Status/field set | `github_project_field_set` resolves IDs live and invokes `item-edit --single-select-option-id`. | Status works only because it is a named single-select field. No dedicated status tool, non-single-select mutation, item removal, or post-write structured confirmation exists. |

Live ID resolution is the right state-source boundary. Repository-qualified item identity is mandatory before general workflow acceptance.

### Discussions and Crew wrappers

The raw GitHub extension publicly registers only:

- `github_discussion_comments`
- `github_discussions_list`
- destructive `github_discussion_delete`

See `.pi/extensions/github/index.ts:22-30`. Create, comment, and update helpers still exist in `.pi/extensions/github/lib/discussions/index.ts`, but are dormant: they are not registered tools and must not be counted as current public capability.

Crew writes instead use `.pi/extensions/hall-crew/crew/lib/communication-tools.ts:5-10`:

| Wrapper | Governance added |
|---|---|
| `crew_kickoff` | Requires run roster, sender, signature, substantive body; rejects a second kickoff when the roster already has a Discussion. |
| `crew_post` | Posts a signed-format finding/review to the roster's canonical Discussion. |
| `crew_tell` | Resolves a roster recipient and posts a directed mention. |
| `crew_ask` | Resolves a roster recipient and posts a directed `[QUESTION]`. |
| `crew_broadcast` | Posts a `[BROADCAST]` and returns the run topic for mesh publication. |

`.pi/extensions/hall-crew/crew/lib/comm.mjs:26-51` verifies only the caller-supplied `from` against roster names, rejects URL-only/non-substantive content, length-checks the caller-supplied signature, and performs GraphQL writes. It does not bind sender identity to the executing actor, prevent duplicate comments, make kickoff check/create atomic, or protect the raw delete tool. This is sufficient cooperative provenance for KR #358, not a security boundary.

## Cross-cutting reliability findings

- `.pi/extensions/github/lib/core/gh.ts:2-10` uses synchronous `execFileSync`; failures are fail-fast but unstructured, and long calls block the extension event loop.
- Most writes have no idempotency key, read-before-write normalization, or consistent structured result.
- Missing inverse operations include label delete, dependency remove, subissue detach, and Project item remove.
- List contracts are truncated or inconsistent across labels, Project fields/items, dependencies, and subissues.
- `node --test tests/github/*.test.mjs` passes 6/6, but those tests reproduce pure logic instead of importing production modules or exercising registrations/CLI behavior. They do not prove runtime fitness.
- Installed `gh 2.97.0` help confirms title/body/milestone edit flags and no `gh issue edit --state` flag.

## Recommendation

Harden the current thin `gh` adapter rather than replacing it. Define stable input/output/error contracts; fix close/reopen; qualify Project items by repository and content type; paginate exhaustive reads; parse every JSON result; validate enums, non-empty arrays, and at-least-one-field updates; add necessary inverse operations; bind Crew attribution to execution identity where Fabric permits; and gate destructive Discussion deletion.

The tradeoff is more adapter and CLI-contract test code. It preserves the compact deployment model and live GitHub IDs while removing ambiguity at the boundary that matters.

## Crew evidence

- Kickoff, roster, criteria, and dependencies: [Discussion #395](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395)
- Independent advisor finding: [comment 18224762](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224762)
- Independent architect finding: [comment 18224788](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224788)
- Lead discrepancy review: [comment 18224809](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224809)
- Specialist exchange question and reconciliation: [18224815](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224815), [18224847](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224847), [18224852](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224852)
- Result-bearing `agents.ask` completeness gate: [question 18224856](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224856), [PASS 18224864](https://github.com/MockaSort-Studio/hall-of-automata-cli/discussions/395#discussioncomment-18224864)

Mesh recorded both independent `DONE` events, the Lead `BROADCAST`, and exchange events containing the relevant Discussion URLs. Discussion remains the durable content record; mesh remains lifecycle state.
