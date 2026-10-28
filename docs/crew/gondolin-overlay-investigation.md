# Gondolin overlay and checkpoint investigation

## Result

Gondolin 0.12 supports Linux overlayfs inside the guest. A guest can combine
multiple read-only VFS mounts as overlay lower directories and write its private
upper/work directories to the VM root disk.

```text
/layers/github + /layers/cpp-bazel
  -> guest overlayfs lowerdirs
  -> merged guest view
  + private upper/work on root disk
```

A spike mounted two separate read-only host directories at `/layers/a` and
`/layers/b`, overlay-mounted them, and read both files successfully.

## Checkpoint behavior

`VmCheckpoint` is disk-only. It serializes one root qcow2 image; `resume()`
creates a fresh COW overlay backed by that image. VFS providers and guest mount
tables are not checkpointed and must be supplied/recreated on every resume.

An overlayfs spike confirmed:

- the overlay mount itself is absent after resume;
- remounting it with the same lower VFS layer works;
- upper/work data placed under persistent root-disk storage (`/opt/...`)
  survives the checkpoint and becomes visible after remount;
- `/tmp` is not suitable for persistent overlay upper/work state.

## Limits

The public Gondolin VM/sandbox API exposes one root disk (`/dev/vda`) and its
root format/mode. It does not expose a supported API for attaching multiple
qcow2 suite disks. Therefore Gondolin supports a *linear* root backing chain:

```text
base checkpoint -> profile checkpoint -> worker COW overlay
```

It does not provide native composition of sibling qcow2 layers such as:

```text
base + github layer + cpp layer
base + github layer + beam layer
```

## Recommendation

Use the filtered Nix-store provider as the initial immutable suite-layer
composition mechanism. It composes arbitrary selected Nix closures without
profile-image combinatorics and is now proven to run the GitHub guest runner.

Use a generic sealed root checkpoint only for base guest preparation. Keep
suite layers external/read-only and recreate their filtered mount on resume.

If startup measurements later justify hydrated profiles, cache complete
content-addressed *suite-set* root checkpoints, never actor images:

```text
platform + base version + ordered suite output identities
```

They are a hot derived cache, not the canonical artifact source. A future
Gondolin multi-disk API or a custom guest boot composition mechanism would be
needed for genuinely reusable sibling disk layers.
