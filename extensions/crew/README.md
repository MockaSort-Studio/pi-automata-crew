# Hall Crew

Hall Crew is the Pi extension for assembling and running isolated specialist
crews.

- `crew/` defines the public tools, Crew policy, composition, and UI.
- `crew-runtime/` owns Comm, Lifecycle, workers, and worktrees.
- `env-runtime/` owns Nix, Gondolin, Armory guest suites, and credentials.

Dependencies flow downward: `crew → crew-runtime → env-runtime`.
