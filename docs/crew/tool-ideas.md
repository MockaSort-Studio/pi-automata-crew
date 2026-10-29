# Tool ideas

Candidate typed tools (Armory suites) that have not earned their cost yet. Per the lazy rule, a tool is
built when a role keeps paying for its absence, with the evidence written down here first. Active work
lives in [implementation-plan.md](implementation-plan.md) and [armory-suite-proposals.md](armory-suite-proposals.md).

## Candidates

| Idea                                            | Roles                                      | Why it might be worth it                                                                                                                              | Evidence so far                                                               |
| ----------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Bounded diff**: stat first, one file's patch  | reviewer, integrator, Lead (Bollo, Mergio) | Reviewers diff whole branches; a stat view with per-file patches on demand and a size cap bounds context and removes `git` from a bash-less reviewer. | Bollo diffed three branches in the first Crew run. Not measured.              |
| **Symbol references**: counts by src/tests/docs | reviewer                                   | Aggregates what `grep` already finds, so dead code is a one-call check.                                                                               | Done by hand once (unused exports in PR #31). Built-in `grep` may suffice.    |
| **Compile / typecheck** per technology          | developer, integrator (Hamlet, Frontenzo)  | Bounded diagnostics instead of full compiler output.                                                                                                  | None: this repository has no build step. Revisit with C++ or TypeScript work. |

## Considered and dropped

- **Mutation probe** (apply a change in a copy, run one test, report fail or pass). Too specific and not
  needed: reviewers can check a test's value by reading it, and the by-hand version was used rarely.
- **Single configurable test runner** (a `command` or `runner` setting). A free-form command is `bash`
  under another name; see S9 in [armory-suite-proposals.md](armory-suite-proposals.md).
