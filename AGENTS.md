# pi-automata-crew

Pi extensions that run a Crew of specialist agents (Comm, Lifecycle, Gondolin isolation, Armory tools).
Runtime: `.pi/extensions/hall-crew/`. Design and status: `docs/crew/`.

## Commands

- `npm test` runs the whole suite (hermetic; it strips worker environment variables).
- `npm run format:check` must pass; `npm run format` fixes it.

## Conventions

- Source files stay near 200 lines. Tests assert behavior and must fail if the feature is removed.
- Never write secrets, tokens or credentials to files, logs or archives.
- Work produced by a Crew lands through a pull request; never push Crew output straight to `main`.

## Using the Crew

- To run engineering work through a Crew, use the `engineering-execution` skill.
- To review a change with independent specialists, use the `engineering-review` skill.
- Launch only through `start_crew`. Reports arrive as messages: end your turn and wait, do not poll.
