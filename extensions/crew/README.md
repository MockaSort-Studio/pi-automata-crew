# Hall Crew

Hall Crew is the Pi extension for assembling and running isolated specialist
crews.

- `crew/` defines the public tools, Crew policy, composition, and UI.
- `runner/` is the crew host: dispatching, member agents, routed tools, and host-side suites.
- `env-runtime/` owns Nix, Gondolin, Armory guest suites, and credentials.

Dependencies flow downward: `crew → runner → env-runtime`.
