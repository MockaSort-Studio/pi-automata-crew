# Serial vs parallel Crew benchmark

## Controlled task

All runs use the same three evidence requests:

1. Comm controller/client: two invariants and one risk.
2. Lifecycle controller/client: two invariants and one risk.
3. Worker/runtime: one invariant and one risk.

The final report must contain `## Invariants`, `## Risks`, and `## Recommendation`, with five file-backed invariants and three mitigated risks.

## Variants

- **Serial:** one SDK worker performs requests 1–3 then synthesizes.
- **Crew:** one Lead plus three identical specialists. The Lead broadcasts kickoff; each specialist receives one disjoint request and works in parallel; the Lead synthesizes directed evidence.

All workers use `thinking: off`. No GitHub or Fabric extension is loaded.

## Metrics per run

- wall clock;
- whole-run and per-worker input/output/reasoning/cache/total tokens and cost;
- system and tool-schema tokens;
- tool call/result tokens and call count;
- per-actor context before/after/peak;
- Comm events and output-contract validity;
- cleanup outcome.

## Results

Pending controlled run.

### Controlled parallel pilot 1

| Metric                                  |                        Serial |                    Crew total |
| --------------------------------------- | ----------------------------: | ----------------------------: |
| Wall clock                              |                       37.259s |                       48.713s |
| Total tokens                            |                        26,708 |                       158,425 |
| Estimated cost                          |                     $0.121548 |                     $0.539408 |
| Input / output / reasoning / cache-read | 13,292 / 1,640 / 453 / 11,776 | 64,014 / 5,835 / 741 / 88,576 |
| Tool calls                              |                            18 |                            31 |
| Tool-call / result tokens               |                   386 / 9,514 |                4,769 / 11,828 |
| Static context (system + schemas)       |                         2,283 |                         7,044 |
| Peak per-actor context                  |                        12,440 |                         9,353 |
| Comm events                             |                           n/a |                            14 |
| Output contract                         |                          pass |                          pass |

Crew specialist peak contexts were 7,675, 5,497, and 9,353 tokens; Lead peak context was 4,942. The Crew total is the sum of all four workers; peak context is intentionally not summed. This is one valid pilot only, not a median.

## Interpretation and next measurement

The parallel split reduced the largest individual context but increased aggregate cost because each worker pays static prompt/schema context and coordination produces extra turns/tool calls. The Crew was slower in this pilot because the Lead waited for three evidence deliveries and synthesized after them; file inspection was parallel, but startup, delivery, and synthesis remain serial stages. Run three controlled rounds and report median/range before making a performance decision.
