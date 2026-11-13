# CI skip policy

## Current required CI

The required GitHub Actions workflow has one `test` job. Its **Required tests**
step runs the Crew, runtime, and Pi Node test files with:

```sh
node --test --test-skip-pattern='^krun: ' \
  tests/crew/*.test.mjs tests/runtime/*.test.mjs tests/pi/*.test.mjs
```

It also runs the extension-load shell test and the format check. The job selects
QEMU with `HALL_VMM=qemu`, so the QEMU versions of the paired backend cases
remain required coverage.

The title-based skip remains because Linux krun coverage is deferred in
[#160](https://github.com/MockaSort-Studio/pi-automata-crew/issues/160). It is
not a production backend-selection change and it does not establish that krun
works on Linux. The skip is temporary: it keeps the required Linux gate useful
while that backend cannot yet be covered there.

## Guardrails

Before the skipped suite, CI runs this separate, unskippable command:

```sh
node --test tests/crew/ci-backend-policy.test.mjs
```

That test locks the skip to exactly three paired backend cases:

1. a VM does not outlive a SIGKILLed owner, and a closed VM leaves nothing
   behind;
2. an idle environment releases its VM and boots a fresh one on the next use;
   and
3. an owner killed while its VM is still booting leaks nothing.

For every listed case, the guard requires both a `krun: ` title and a required
`qemu: ` twin. It enumerates the test titles actually registered by every Node
test file named by the required CI command, scans those sources for `krun: `
literals, and rejects an unpaired literal. It also asserts the workflow's sole
job, QEMU selection, skip expression, required test paths, extension-load
command, and format step.

`package.json` is also a CI-gate file: the guard requires its `test:suite`
script to name the same Node test-file paths as required CI, and requires all
such paths to match files. This prevents a test from silently disappearing
because Node ignores a missing path.

## Residual risk and review

A title-prefix skip is still capable of hiding a test if a pull request changes
both `.github/workflows/ci.yml` and the policy test to permit it. Treat the
workflow and `package.json` as gate files: changes to them, especially alongside
the policy test, need human review. Branch protection and review are therefore
the remaining governance control; the in-repository test cannot protect against
a coordinated change to its own rules.

Remove the skip only when krun has Linux CI coverage and the work tracked by
#160 is complete. At that point, make those three krun cases required rather
than title-excluded.
