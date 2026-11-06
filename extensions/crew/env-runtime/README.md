# Environment Runtime

The isolated worker-environment layer for Hall Crew. It owns Nix suite
acquisition, filtered store views, Gondolin VMs, Armory runner proxies, and
credential injection.

It exposes approved guest operations to `crew-runtime`; it never defines Crew
roles or policy. Host-owned credential policy binds suites to secret slots and
host destinations; Armory does not choose credential sources or network policy.

See [docs/crew/typed-git-workflow.md](../../../docs/crew/typed-git-workflow.md) for how a developer works through the typed Git operations against a seeded workspace.

## Repository dependency cache

The Gondolin rootfs remains minimal. Build a local shared cache on demand:

```sh
npm run build:guest-cache -- --profile gondolin-alpine-node24
```

The builder runs `npm ci` only inside a disposable Gondolin guest with registry
access limited to `registry.npmjs.org`. A Crew that requests
`environment.dependencyCache: "required"` then finds the immutable cache at
`~/.cache/pi-crew/dependencies/<cache-key>`. The key binds `package-lock.json`
and the declared guest profile; its manifest records the guest Node, machine,
and OS fingerprint. Worker boot verifies that fingerprint before mounting the
cache's `node_modules` read-only at `/workspace/node_modules`. The worker
configuration carries only cache identity, never a host path. Workers never
run `npm install` or receive host `node_modules`.

This cache is repository-specific state. Generic Git/GitHub capabilities remain
Armory guest closures and are not part of this cache or the microVM rootfs.
