import path from "node:path";

export const GUEST_WORKSPACE = "/workspace";
export const HIDDEN_WORKSPACE_PATHS = ["/.env", "/.npmrc", "/node_modules", "/.venv", "/dist"];
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".venv", "dist"]);

const stripAtPrefix = (value) => (value.startsWith("@") ? value.slice(1) : value);
const toPosix = (value) => value.split(path.sep).join(path.posix.sep);
const isInside = (root, value) => {
  const relative = path.relative(root, value);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export function toGuestPath(localCwd, inputPath) {
  const input = stripAtPrefix(inputPath.trim());
  if (!input) return GUEST_WORKSPACE;
  const absolute = path.isAbsolute(input) ? input : path.resolve(localCwd, input);
  if (!isInside(localCwd, absolute)) return path.posix.resolve("/", toPosix(absolute));
  const relative = path.relative(localCwd, absolute);
  return relative ? path.posix.join(GUEST_WORKSPACE, toPosix(relative)) : GUEST_WORKSPACE;
}

export const shouldSkipEntry = (entry) => SKIPPED_DIRECTORIES.has(entry);

export function matchesGlob(filePath, pattern) {
  const normalized = toPosix(pattern);
  return normalized.includes("/")
    ? path.posix.matchesGlob(filePath, normalized) || path.posix.matchesGlob(filePath, `**/${normalized}`)
    : path.posix.matchesGlob(path.posix.basename(filePath), normalized);
}
