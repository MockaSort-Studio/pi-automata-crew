# Pi Automata Crew

Private alpha repository for a Pi-native Crew runtime. It is a runtime and tooling project, not a
port of the Hall Claude Code skills.

Hall Crew starts isolated specialist workers, explicitly dispatches their work, carries typed Crew
state over Comm, and cleans up processes, worktrees, and VMs. Gondolin provides one VM per worker;
Armory provides approved guest operations with narrow credential and network grants.

## Scope

In scope: Crew runtime, Comm, lifecycle, TUI, Gondolin, Armory, credentials, observability, and
validation. Claude skills and methodology migration are out of scope.

See [Saga 2](docs/saga/Saga-2-The-Loosed-Harness-[open].md) and the
[implementation plan](docs/crew/implementation-plan.md) for the active direction.

## Develop

Requires Node 24 and npm.

```bash
npm ci
npm test
npm run format:check
```

The test suite is self-contained. Tests that need unavailable Pi TUI bindings or optional host
facilities skip deliberately. Gondolin/Armory live canaries require Nix, released Armory artifacts,
and host VM support; they are not installed by `npm ci`.

## Layout

- `.pi/extensions/hall-crew/crew/` — policy, roles, composition, and TUI.
- `.pi/extensions/hall-crew/crew-runtime/` — Comm, Lifecycle, workers, worktrees, cleanup.
- `.pi/extensions/hall-crew/env-runtime/` — Gondolin, Armory, Nix, and credentials.
- `tests/crew/`, `tests/runtime/` — deterministic unit and integration tests.
- `docs/crew/` — alpha status, decisions, measurements, and active plan.

Dependencies flow downward: `crew → crew-runtime → env-runtime`.
