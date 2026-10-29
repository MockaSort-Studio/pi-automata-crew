# Contributing

Pi Automata Crew is a private alpha for a functional, secure Pi Crew runtime and its tooling.
Claude Code skill and methodology migration are out of scope.

## Before opening a pull request

```bash
npm ci
npm test
npm run format:check
```

Keep source, tests, and documentation at or below 200 lines per file. Prefer small modules with
one responsibility. Explain why in comments; make names explain what.

## Boundaries

- `crew/` owns public tools, policy, roles, composition, and TUI.
- `crew-runtime/` owns Comm, Lifecycle, workers, worktrees, events, and cleanup.
- `env-runtime/` owns Gondolin, Nix/Armory acquisition, guest proxies, and credentials.
- Dependencies flow only downward: `crew → crew-runtime → env-runtime`.
- Do not add broad shell, network, or credential access for convenience. Grants must be explicit,
  role-scoped, and testable.
- Do not add project dependencies, guest git, or container runtimes to Armory suites.

## Tests and evidence

Tests must be deterministic and avoid live credentials. A live canary must record only bounded,
content-free evidence and clean up workers, worktrees, VMs, and servers. Never commit a token,
credential descriptor, runtime artifact, or generated VM state.

See the [implementation plan](docs/crew/implementation-plan.md) and
[Armory proposals](docs/crew/armory-suite-proposals.md) before changing runtime boundaries.
