# Releasing

Releases are tagged on GitHub and published to npm through the shared
[`release-npm`](https://github.com/MockaSort-Studio/actions) workflow, the same one the Armory uses. Nothing is
published by merging to `main`.

## Steps

1. Move the `[Unreleased]` entries of `CHANGELOG.md` under a new `## [x.y.z] - YYYY-MM-DD` heading.
2. Set `version` in `package.json` to `x.y.z` and remove `"private": true`.
3. Open a pull request with those two changes and merge it once CI is green.
4. Tag the merge commit and push the tag: `git tag vx.y.z && git push origin vx.y.z`.

The tag starts `.github/workflows/release.yml`, which verifies the package (version not already on npm, format check
and the test suite), stages it on npm for approval (`npm stage publish`; a human approves it there), and creates the
GitHub release with the changelog section as its notes.

To rehearse without publishing, run the **Release** workflow manually with mode `verify` or `dry-run`.

## Install sources

- GitHub: `pi install git:github.com/MockaSort-Studio/pi-automata-crew@vX.Y.Z`
- npm: `pi install npm:@mockasort-studio/pi-automata-crew` (once the first version is approved on npm)
