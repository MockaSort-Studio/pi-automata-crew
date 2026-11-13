# Armory tools: the crew declares, the host registers (design for #200)

Status: proposal.

The Armory is a centralized catalog of tools. Everything starts from the crew.

1. A crew is assembled. Its roster entries, roles and assignment declare the tools each member may use.
2. The host looks those tools up in the allow lists. Tools not yet cached are pulled from the Armory.
3. The host registers the tools the crew needs and injects them. A tool already registered is simply there.

A member can use a tool if and only if it is on its allow list. Crew keeps no per-operation knowledge of any
suite: no operation tables, no input allow-lists, no schema snapshots, no adapters for one suite's output.
New Armory tools and options work without a Crew change.

## Removed

`repository-targets.mjs`, `repository-authorization.mjs`, the operation snapshot and its drift tests, the
input checks in the `github-suite.mjs` hook, and the `headRefOid` adapter.
