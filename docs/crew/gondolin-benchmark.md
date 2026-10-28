# Gondolin benchmark, assessment and optimization

Measured 2026-10-04 on one machine: Apple M1, 8 GiB RAM (about 2 GiB free), 8 cores,
`@earendil-works/gondolin` 0.12.0. Single runs or small samples; treat differences under
about 20% as noise.

Reproduce: `node scripts/bench/crew-scale.mjs <none|gondolin|armory> <N>` (launch cost, no
model calls; `HALL_VMM=qemu|krun` selects the backend) and `node scripts/bench/gondolin-vm.mjs`.

## Measure memory as the OS does

Memory below is the macOS **physical footprint** (dirty plus compressed pages), which is what
pressures RAM. RSS also counts reclaimable file-backed pages and overstated a QEMU VM by
about 2x (301 MB RSS against 157 MB footprint at idle). An earlier version of this document
quoted RSS and said an active Gondolin worker cost 600-880 MB; the real figure is about
400 MB with QEMU and about 295 MB with libkrun.

## Model usage

Same trivial task, host versus Gondolin with the Armory GitHub suite: 14,497 versus 14,744
tokens (+1.7%), $0.0160 versus $0.0164, identical turns and tool calls. **Not a factor.**

## Where a worker's memory goes (footprint)

| Part | Size |
| --- | --- |
| Shared per Crew: comm + lifecycle servers | 41-67 MB |
| `worker.mjs` | 17 MB |
| Pi, host worker | 117 MB |
| Pi, sandboxed worker, VM up (libkrun run) | 167 MB |
| Pi, sandboxed worker, VM released | about 113 MB, the same as a host Pi |
| VM, libkrun: idle / after a real workload | 55 / 100 MB |
| VM, QEMU: idle / after a real workload | 151 / 212 MB |
| Guest RAM allotment (1 GiB, 512 MiB, 256 MiB) | no difference (212-216 MB) |

So an active sandboxed worker (Pi, `worker.mjs` and VM) is about 295 MB with libkrun (about 400
MB with QEMU), plus its share of the servers (64 MB per Crew); a host worker is about 134 MB;
a worker whose VM was released is about 140 MB. The 54 MB by which a sandboxed Pi exceeds a host
Pi is the live VM client's state, not the imported SDK: it disappears when the VM is released, so
lazy-loading the SDK would save nothing (and `session_start` boots the VM anyway).

The guest itself is not the cost. Idle and booted, it uses about 80 MB of its 990 MB (its only
processes are `sandboxd`, 84 kB, and `rngd`); the rootfs is a 279 MB disk image (qcow2
overlay, not RAM), the initramfs is 6 MB, and QEMU already runs with `-nodefaults` and
virtio devices only. The difference between VMMs is the hypervisor, not the image.

## What was done

| Finding | Action | Result |
| --- | --- | --- |
| Pi auto-discovered the worktree's `.pi` and loaded the whole Crew extension | `--no-approve` (user-level provider auth and explicit `--extension` still load) | Pi 251 to 160 MB RSS, ready 0.95 to 0.61 s |
| `--no-extensions` looked lighter still | **Rejected**: it drops the user's provider-auth extension, every model call failed | kept `--no-approve` |
| **QEMU's footprint is twice libkrun's** | `chooseVmm()`: libkrun where Gondolin's prebuilt runner exists (macOS arm64, Linux x64), QEMU fallback, `HALL_VMM` override; QEMU no longer required on libkrun hosts | VM 212 to 100 MB; 4 concurrent boots 3.5 to 2.45 s; real GitHub call 1.28 to 1.0 s |
| `gh` ran from the mounted closure: 736 ms per call | Suite wrapper copies it to guest tmpfs (hall-armory PR #6) | 93 ms; a GitHub call matches the host's own `gh` |
| A VM lived as long as its worker | Release after 20 s idle, warm at run start | 3 held Armory workers: 1,874 to 716 MB RSS total |
| Proxy imported the Gondolin extension through a native `import()` | Merged into the extension | `pi-coding-agent` is dev-only; two failure classes gone |
| A swallowed `session_start` error left a worker ready but without its tools | Extension ends the worker; a launch fails once any worker exits before ready | under 1 s instead of a 30 s timeout |
| Preflight re-ran per worker | Reuse a success for 30 s | 110 ms saved per extra worker |
| Dead code and scattered tiny modules | Removed a second `main`-branch Armory entrypoint and unused modules; merged the Nix helpers (6 files into `armory-nix.mjs`), credentials (3 into `credentials.mjs`), guest runner and proxies (2 into `guest-suite.mjs`) | isolation layer 22 files to 14 while gaining VMM selection, idle release and warm-up |
| Five core files over the 200-line ceiling | Split along real seams (see the code-compaction pass in the plan) | none over 200 lines |

Also fixed on the way: a worker built its credential lease as a plain object and then called
`Map.clear()` on it in its exit handler, which would have thrown.

## Tried and rejected

- **Smaller guest RAM:** no footprint change.
- **A second VM per worker** (suspected from a duplicated module): refuted, one VM.
- **Folding `worker.mjs` into the lifecycle server:** saves 17 MB, not the 52 MB RSS implied.

## Where microvm.nix sits

microvm.nix is a Nix flake that builds NixOS guests and runs them on eight hypervisors (qemu,
cloud-hypervisor, firecracker, crosvm, kvmtool, stratovirt, alioth, and vfkit on macOS), with a
fixed 512 MB default, a read-only squashfs or erofs root and 9p or virtiofs shares. It defines
and launches guests; it has no command-execution API, no programmable filesystem and no HTTP
interception with secret placeholders, which are what Gondolin provides and what Crew depends
on. Adopting it would mean replacing Gondolin and rebuilding those, plus building NixOS guests
on macOS (the Linux-builder problem again). The lever it would offer, a minimal VMM, is
already inside Gondolin as libkrun, which the measurements show halves the VM. A custom guest
image is possible through `gondolin build` without microvm.nix, but the guest is already about
80 MB, so it would not move the total.

## Assessment

**Efficient: yes.** No model cost, a sandboxed GitHub call costs what the host's own does, a
booted VM executes in 2 ms, launch costs 0.5-1.5 s over the host, teardown is 45-110 ms with no
residue.

**Scalable: RAM-bound for active workers only.** Idle workers cost host-level memory; an active
sandboxed worker is about 295 MB with libkrun (about 400 MB with QEMU).

**Over-engineered: the code no, the chain yes.** The isolation layer is 14 files and about 1,020
lines, none over 200 (before: 22 files). The weight is the dependency chain (Nix, a VMM,
Gondolin, a binary cache, a release catalog) for a 37 MB closure; tarballs remain the
documented simpler path.

**Brittle: lower.** An earlier version of this document said a failed sandbox extension left a
worker on the host. That was wrong: Pi exits when an explicitly requested extension fails to
load, and the live failures were handler errors that left a worker without its tools (fail-closed
at use, silent at launch). Both are now fatal at launch. What remains is environment drift
(dependencies, Nix, the cache, the token), which launch-time checks report and fall back from,
and the user's global Pi setup that workers inherit (provider auth).
