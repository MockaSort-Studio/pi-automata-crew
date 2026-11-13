# Pi Packaging

This repository installs as a [Pi package](https://pi.dev/packages). This doc describes the
manifest in `package.json` and how a release is cut.

## The manifest

`package.json` carries a top-level `pi` key:

```json
{
  "pi": {
    "extensions": ["extensions/crew.ts"],
    "skills": ["skills"]
  }
}
```

- `extensions` lists explicit entry-point files rather than a directory glob. `extensions/crew/`
  contains runtime libraries, not standalone Pi extensions; listing entry points keeps the manifest
  matched to what `pi -e` actually loads.
- `skills` points at root `skills/`, which Pi auto-discovers recursively for `SKILL.md` directories
  (currently `engineering-execution`, `engineering-review`, `post-iteration-review`, and
  `security-boundary-review`).
- `package.json` is publishable (`engines.node` is `>=24`). A release is a pushed tag; see [releasing](release.md).

### Keeping the manifest honest

`tests/pi/test-extension-load.sh` loads the package's declared extensions from a relocated package
copy with `pi -e <path>` to prove they work outside this checkout's directory layout.
`tests/pi/manifest-paths.test.mjs` cross-checks the `pi.extensions` manifest against every `-e`
path that script loads, and asserts every manifest path (`extensions` and `skills`) exists on
disk. If a manifest path is deleted, or an entry point used by the relocated-load test is dropped
from the manifest, that test fails. Both files must be updated together whenever an extension is
added, renamed, or removed.

## Installing

```bash
# From git (pin a release tag)
pi install git:github.com/MockaSort-Studio/pi-automata-crew@v0.1.0-beta.0

# From a local checkout
pi install /path/to/pi-automata-crew

# Verify
pi list
```

`pi install` writes to `~/.pi/agent/settings.json` by default; pass `-l` to install project-locally
into `.pi/settings.json` instead.

## Release procedure

See [releasing](release.md): a release is a pushed tag `vX.Y.Z` (for example `v0.1.0-beta.0`); the Release workflow verifies
the package, stages it on npm for a human to approve, and creates the GitHub release from the changelog.
