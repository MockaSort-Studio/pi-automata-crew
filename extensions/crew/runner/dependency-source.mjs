import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|css|html|md|txt)$/i;
const license = /^(?:license|licence|notice|copying)(?:\.[a-z]+)?$/i;

// Only ordinary source files are copied. No links, dotfiles, nested dependencies,
// configuration, arbitrary data files, or executable native artifacts cross the boundary.
export function snapshotPackage(root, expected) {
  let metadata;
  try {
    const rootInfo = lstatSync(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error();
    const info = lstatSync(join(root, "package.json"));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error();
    metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    throw new Error(`Dependency source unavailable: ${expected.name}`);
  }
  if (metadata.name !== expected.name || metadata.version !== expected.version)
    throw new Error(`Dependency source version mismatch: ${expected.name} expected ${expected.version}`);
  const files = {};
  // Do not copy arbitrary package metadata (which can contain private registry settings).
  files["package.json"] = Buffer.from(JSON.stringify({ name: metadata.name, version: metadata.version, type: metadata.type }, null, 2) + "\n");
  function visit(dir, prefix = "") {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || /credential|secret|token|\.npmrc/i.test(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(dir, entry.name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) visit(path, relative);
      else if (info.isFile() && info.nlink === 1 && (source.test(entry.name) || license.test(entry.name))) {
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== info.ino || opened.dev !== info.dev)
            throw new Error(`Dependency source changed while reading: ${expected.name}`);
          files[relative] = readFileSync(fd);
        } finally { closeSync(fd); }
      }
    }
  }
  visit(root);
  return { files, manifest: { name: expected.name, version: expected.version, files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, hash(bytes)])) } };
}
