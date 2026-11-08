# Crew verification and dependency sources

A bash grant permits commands in the member's Gondolin guest; it does **not** promise Git, a package manager, project dependencies, or any particular test runner. Inspect the member's verification prerequisites before choosing checks. `node --check path/to/file.mjs` is a syntax check when guest Node is present, not a project test.

For members granted bash, Crew attempts an anonymous, bounded HTTPS fetch from `registry.npmjs.org` for the reviewed exact pins in `extensions/crew/runner/dependency-pins.mjs`. The pins are checked against `package-lock.json` in tests. Full tarball SHA-512 SRI is checked before decompression or archive parsing. Invalid, missing, timed-out or incompatible artifacts are unavailable, not substituted from the host installation. Archive extraction is bounded and rejects links, special entries and unsafe paths. There is no persistent dependency cache. The public artifacts—not host credentials or configuration—supply the exposed bytes. This does not assert that a public package cannot itself contain sensitive strings.

Bootstrap decompression and archive parsing currently run synchronously on the Crew host and are capped at 128 MiB unpacked per artifact. Main-host measurements for the reviewed pins (excluding network) ranged from 2.26 ms to 94.76 ms; the largest unpacked tar was Pi SDK at 25,024,512 bytes. These are single-run observations, not a worst-case latency guarantee: a future larger pinned artifact could block other crews longer, and changing pins requires renewed measurement or an asynchronous parser.

Available packages are read-only snapshots at `/opt/crew/dependency-sources/`; `manifest.json` lists versions, SRI and SHA-256 of each extracted file. Hashes describe exposed file identity; the SRI verifies the downloaded artifact. Source visibility does **not** install or make native modules and dependency trees runnable.

When Prettier is available, format workspace files using guest bash, for example:

```sh
node /opt/crew/dependency-sources/prettier/bin/prettier.cjs --write /workspace/path/to/file.mjs
```

Do not use a host formatter fallback. If Prettier is unavailable, say so and request hosted CI or coordinator help. Focused tests may run in the guest only if their real prerequisites are present; an unavailable project dependency is **CI-required**, not a passing or skipped test. Do not manufacture skips.

The supported hosted path is the `CI` pull-request workflow (`.github/workflows/ci.yml`): its **Required tests (all except the excluded krun cases)** step runs `node --test` over the project test files, including focused tests under `tests/crew` and `tests/runtime`; it also boots the QEMU-backed live guest tests. `npm run format:check` is a separate workflow step. Push to the authorized branch and open a draft PR; use the existing pull-request checks and workflow-run failed-log operations to retrieve outcomes. CI's documented krun exclusion is unchanged and must not be represented as krun coverage. A focused test can also be run where prerequisites are installed with `node --test tests/crew/dependency-source.test.mjs tests/crew/dependency-mount.test.mjs tests/runtime/dependency-source-live.test.mjs`; this is not a substitute for the full required CI step.

Reports must distinguish **guest checks**, **Main-host evidence**, **hosted CI**, and **unperformed checks**, including failures and missing prerequisites. A host-side artifact or provider test is not evidence of guest execution or read-only enforcement in a running guest.
