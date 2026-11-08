// The promise-style `fs` that isomorphic-git (and so the GitHub suite's Git operations) needs, over an
// environment's host-held workspace. The workspace provider already implements every method, with node's
// argument order and error codes, so this only presents them as `fs.promises`. In production the
// provider is a private MemoryProvider: symlinks resolve inside its in-memory root, not host paths.
const METHODS = [
  "readFile",
  "writeFile",
  "mkdir",
  "rmdir",
  "unlink",
  "stat",
  "lstat",
  "readdir",
  "readlink",
  "symlink",
];

export function workspaceFs(provider) {
  return { promises: Object.fromEntries(METHODS.map((name) => [name, (...args) => provider[name](...args)])) };
}
