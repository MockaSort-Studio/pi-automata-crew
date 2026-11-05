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

## Install

This repository is a [Pi package](docs/crew/packaging.md): `package.json` declares a `pi` manifest
that exposes the Crew extension (`extensions/crew.ts`), web extension, and reviewer skills under
`skills/`. Required host tools: Node 24, npm, and the `pi` CLI.

Install straight from git (pin a tag once alpha releases start, e.g. `@v0.1.0-alpha.1`):

```bash
pi install git:github.com/<org>/pi-automata-crew
```

Or install a local checkout by path, for development:

```bash
pi install /path/to/pi-automata-crew
```

Confirm the package is registered and its resources load:

```bash
pi list
```

Update an installed package to the latest pinned ref:

```bash
pi update --extensions
```

See [docs/crew/packaging.md](docs/crew/packaging.md) for the manifest contents and the release
procedure.

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

- `extensions/crew/crew/` — policy, roles, composition, and TUI.
- `extensions/crew/crew-runtime/` — Comm, Lifecycle, workers, worktrees, cleanup.
- `extensions/crew/env-runtime/` — Gondolin, Armory, Nix, and credentials.
- `skills/` and root `SPECIALIST_ROUTES` — Crew procedures and routing policy.
- `tests/crew/`, `tests/runtime/` — deterministic unit and integration tests.
- `docs/crew/` — alpha status, decisions, measurements, and active plan.

Dependencies flow downward: `crew → crew-runtime → env-runtime`.
