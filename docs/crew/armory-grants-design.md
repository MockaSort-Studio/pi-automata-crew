# Armory tools: declared grants are the only authority (design for #200)

Status: proposal. Supersedes the per-operation tables Crew keeps for the GitHub suite.

## Principle

A member may call exactly the Armory operations its roster entry, role and assignment declare. Crew turns those
declarations into a map at launch, fetches the suite from the pulled Armory artifact, and exposes only the
mapped operations. The tools are universal: they do what their inputs say with whatever credential the host
provides. What a credential can reach is the host's concern; Crew does not inspect tool inputs and Armory
suites know nothing about Crew.

## What exists today (to remove)

- `env-runtime/lib/repository-targets.mjs`: a hand-written classification of all 49 GitHub operations.
- `env-runtime/lib/repository-authorization.mjs`: per-operation allow-lists of input names and bounds.
- `tests/fixtures/armory-operations.json`, `scripts/snapshot-armory-operations.mjs`, and the drift and
  allow-list tests: they keep the two tables in step with each release.
- `runner/github-suite.mjs` `tool_call` hook: input authorization, own-pull-request check, forced draft,
  review-ID tracking.
- The `headRefOid` adapter in the host gh transport (hall-armory#18 ships it natively).
- Hand-named operation sets used to validate grants: `GITHUB_BASE_TOOL_SET`, `personaReads`, the deferred
  set and `implementationRoleCeiling`. Operation names stay in roster and role declarations, but they are
  validated against the operations the pulled catalog lists, not against a Crew copy.

## Target

1. Declarations: `(suite, operation)` pairs in roster, roles and the assignment (`tools`,
   `requiredCapabilities`), as now.
2. At launch Crew resolves the declarations against the pulled catalog. A declared operation the catalog does
   not list fails the launch (the existing capability preflight). A new Armory operation needs no Crew change.
3. The suite module is loaded from the verified artifact and only granted operations are registered with the
   member's agent. An ungranted operation does not exist for that member.
4. One check at call time: the tool name is in the member's granted set. Nothing else is inspected.

## Consequences accepted

The calls a worker makes with a granted operation are no longer narrowed by Crew. Removed with the code above:
repository binding of inputs, forced drafts, push confinement to the worker branch, own-pull-request and
review-ID checks. Anything that matters beyond the grant belongs to the credential the host supplies. If a
deployment wants those limits, they are enforced by the credential or by a host policy outside Crew's tool path.

Not affected: the runner's own use of the host token (CI verification, salvage, the PR it opens for a member)
is Crew's control-plane code, not worker authority, and stays as it is.

## Migration (each step its own reviewed PR)

1. Grant resolution from the catalog: replace hand-named sets; unknown operations fail preflight.
2. Register only granted operations; call-time check is set membership.
3. Delete the tables, snapshot, drift tests, authorization allow-lists and the `github-suite.mjs` hook
   logic; keep tests that prove an ungranted operation is unavailable.
4. Delete the `headRefOid` adapter once the consumed release provides it (`armory-6d8247e` does).
5. Update docs (`github-ci-metadata-egress.md`, `typed-git-workflow.md`) to describe grants as the authority.

## Open questions

- Does the suite module let the host register a subset of its operations, or does it register all of them
  on activation? If all, Crew filters at registration, which is still one set lookup.
- Guest-run suites (`guest-suite.mjs`, `worker-armory-config.mjs`) already receive their operation list from
  the grant; confirm they need no change.
