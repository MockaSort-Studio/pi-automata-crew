# CI backend policy

The required `test` job runs generic and live tests with QEMU, including the QEMU
worker smoke, idle-release and owner-death cases. Only names beginning `krun: `
are excluded from that job. The four explicit krun cases continue executing in
`krun (experimental, non-blocking)`, with TAP logs archived even on failure.
`npm test` locally remains unchanged and still includes both backends.

This is an explicitly user-approved gate-policy change, not a runtime fix or a
claim that krun passes. Production backend selection is unchanged. Further krun
investigation is deferred. Do not make the experimental check required in branch
protection while this policy is in effect.

## Evidence and limitations

Draft PR #124 records the hosted Linux diagnostics. Ubuntu 24.04 permits KVM
VM/vCPU creation and QEMU boots, but a minimal krun boot aborts. The registry
image's 19,070,976-byte `krun-kernel` begins `fc8b038d6304e8000000005d890383ed`
and is not ELF, matching the unresolved x86_64 image-format report in
[upstream Gondolin #91](https://github.com/earendil-works/gondolin/issues/91).
This supports that hypothesis but does not prove a repair. The image already has
a valid 512-byte initrd; Gondolin 0.14.0 includes the older initrd repair.
Ubuntu 22.04 is not an alternative: the bundled runner requires GLIBC_2.36 and its
QEMU 6.2 lacks the required stream networking option.

Restore required krun coverage only after a supported image/runtime combination
passes the explicit cases. Experimental failures must remain visible; they are
not evidence of intermittent flakiness and must not be reported as success.
