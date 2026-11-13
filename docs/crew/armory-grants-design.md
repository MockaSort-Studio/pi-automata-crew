# Armory tools: the crew declares, the host registers (design for #200)

Status: implemented in #211.

The Armory is a centralized catalog of tools. Everything starts from the crew.

1. A crew is assembled. Its roster entries, roles and assignment declare the tools each member may use.
2. The host looks those tools up in the allow lists. Tools not yet cached are pulled from the Armory.
3. The host registers the tools the crew needs and injects them. A tool already registered is simply there.

A member can use a tool if and only if it is on its allow list. Crew keeps no per-operation knowledge of any
suite: no operation tables, no input allow-lists, no schema snapshots (the one exception is below).
New Armory tools and options work without a Crew change.

## Control plane, not authority

Crew's own "done means green CI" gate and salvage are GitHub-aware features of the runner. They act only
through operations the member was granted (salvage needs status, checkout, stage, commit and push; holding a
pull request to green CI needs PR create, view and files), and the runner learns which PR and commit a member
produced from the results of the member's own tool calls, not from what the model says. This is the one place
Crew interprets a suite's output. It grants nothing and checks no input.

## Removed

`repository-targets.mjs`, `repository-authorization.mjs`, the operation snapshot and its drift tests, the
input checks in the `github-suite.mjs` hook, the `headRefOid` adapter, the guest GitHub egress rules and the `github-discussions` bundle.
