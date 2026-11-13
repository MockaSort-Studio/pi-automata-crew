# CI backend policy

CI is one required `test` job. It runs the generic and live tests with QEMU, including the QEMU worker smoke,
idle-release and owner-death cases. There is no other job: a check that is expected to fail only trains members
and the CI gate to ignore red.

The three explicit krun cases (names beginning `krun: `) are **excluded** from that job
(`--test-skip-pattern='^krun: '`). Linux krun is therefore not covered by CI at all right now. `npm test` locally
is unchanged and still includes both backends, so krun can be exercised on a machine where it works (macOS).

This is an explicit user decision, not a runtime fix and not a claim that krun passes. Production backend
selection is unchanged. Restoring Linux krun coverage is tracked separately and is deferred.

## Evidence and limitations

Hosted Linux diagnostics: Ubuntu 24.04 permits KVM VM/vCPU creation and QEMU boots, but a minimal krun boot aborts.
The registry image's 19,070,976-byte `krun-kernel` begins `fc8b038d6304e8000000005d890383ed` and is not ELF,
matching the unresolved x86_64 image-format report in
[upstream Gondolin #91](https://github.com/earendil-works/gondolin/issues/91). This supports that hypothesis but
does not prove a repair. The image already has a valid 512-byte initrd; Gondolin 0.14.0 includes the older initrd
repair. Ubuntu 22.04 is not an alternative: the bundled runner requires GLIBC_2.36 and its QEMU 6.2 lacks the
required stream networking option.

Restore krun coverage only after a supported image/runtime combination passes the three explicit cases, and then
as a required check.
