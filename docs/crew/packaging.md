# Pi Packaging

This repository installs as a [Pi package](https://pi.dev/packages). This doc describes the
manifest in `package.json` and how to cut an alpha release.

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
- `package.json` keeps `"private": true`. That only blocks `npm publish` to a registry; it does not
  block `pi install` by git URL or local path, which is how this package is distributed during the
  alpha.

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
# From git (pin a tag once alpha releases exist)
pi install git:github.com/<org>/pi-automata-crew@v0.1.0-alpha.1

# From a local checkout
pi install /path/to/pi-automata-crew

# Verify
pi list
```

`pi install` writes to `~/.pi/agent/settings.json` by default; pass `-l` to install project-locally
into `.pi/settings.json` instead.

## Release procedure

1. Land changes on `main` and confirm CI is green (`npm test`, `npm run format:check`).
2. Tag the commit on `main`: `vX.Y.Z-alpha.N` (for example `v0.1.0-alpha.1`). Alpha releases only
   increment the `-alpha.N` suffix until the package is ready to drop the pre-release tag.
3. Push the tag. Consumers pin to it with `pi install git:github.com/<org>/pi-automata-crew@vX.Y.Z-alpha.N`.
4. Do not publish to the npm registry while `"private": true` is set in `package.json`.
