# Environment Runtime

The isolated worker-environment layer for Hall Crew. It owns Nix suite
acquisition, filtered store views, Gondolin VMs, Armory runner proxies, and
credential injection.

It exposes approved guest operations to `crew-runtime`; it never defines Crew
roles or policy. Host-owned credential policy binds suites to secret slots and
host destinations; Armory does not choose credential sources or network policy.
