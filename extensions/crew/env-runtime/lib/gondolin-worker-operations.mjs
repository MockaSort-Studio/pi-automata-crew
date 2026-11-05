import path from "node:path";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, truncateLine } from "@earendil-works/pi-coding-agent";
import { matchesGlob, shouldSkipEntry, toGuestPath } from "./gondolin-worker-paths.mjs";

const DEFAULT_GREP_LIMIT = 100;
const mimeType = (filePath) => {
  const ext = path.posix.extname(filePath).toLowerCase();
  return (
    { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }[
      ext
    ] ?? null
  );
};

export const readOperations = (vm, cwd) => ({
  readFile: (filePath) => vm.fs.readFile(toGuestPath(cwd, filePath)),
  access: (filePath) => vm.fs.access(toGuestPath(cwd, filePath)),
  detectImageMimeType: (filePath) => Promise.resolve(mimeType(toGuestPath(cwd, filePath))),
});

export const writeOperations = (vm, cwd) => ({
  writeFile: (filePath, content) => vm.fs.writeFile(toGuestPath(cwd, filePath), content, { encoding: "utf8" }),
  mkdir: (dirPath) => vm.fs.mkdir(toGuestPath(cwd, dirPath), { recursive: true }),
});

export const editOperations = (vm, cwd) => ({ ...readOperations(vm, cwd), ...writeOperations(vm, cwd) });

const existsOperation = (vm, cwd) => async (filePath) => {
  try {
    await vm.fs.access(toGuestPath(cwd, filePath));
    return true;
  } catch {
    return false;
  }
};

export const lsOperations = (vm, cwd) => ({
  exists: existsOperation(vm, cwd),
  stat: (filePath) => vm.fs.stat(toGuestPath(cwd, filePath)),
  readdir: (dirPath) => vm.fs.listDir(toGuestPath(cwd, dirPath)),
});

async function walk(vm, root, visit, signal) {
  if (signal?.aborted) throw new Error("Operation aborted");
  const stat = await vm.fs.stat(root, { signal });
  if (!stat.isDirectory()) return visit(root, path.posix.basename(root));
  const visitDirectory = async (directory, relative) => {
    for (const entry of await vm.fs.listDir(directory, { signal })) {
      if (signal?.aborted) throw new Error("Operation aborted");
      if (shouldSkipEntry(entry)) continue;
      const guestPath = path.posix.join(directory, entry);
      const relativePath = relative ? path.posix.join(relative, entry) : entry;
      let entryStat;
      try {
        entryStat = await vm.fs.stat(guestPath, { signal });
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        if (!(await visitDirectory(guestPath, relativePath))) return false;
      } else if (!(await visit(guestPath, relativePath))) return false;
    }
    return true;
  };
  return visitDirectory(root, "");
}

export const findOperations = (vm, cwd) => ({
  exists: existsOperation(vm, cwd),
  glob: async (pattern, searchPath, { limit }) => {
    const results = [];
    await walk(vm, toGuestPath(cwd, searchPath), async (guestPath, relativePath) => {
      if (matchesGlob(relativePath, pattern)) results.push(guestPath);
      return results.length < limit;
    });
    return results;
  },
});

const lineMatcher = (pattern, literal, ignoreCase) => {
  if (literal) {
    const needle = ignoreCase ? pattern.toLowerCase() : pattern;
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
  const expression = new RegExp(pattern, ignoreCase ? "i" : undefined);
  return (line) => expression.test(line);
};

export async function executeGrep(vm, cwd, params, signal) {
  const root = toGuestPath(cwd, params.path ?? ".");
  const rootIsDirectory = (await vm.fs.stat(root, { signal })).isDirectory();
  const match = lineMatcher(params.pattern, params.literal, params.ignoreCase);
  const limit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
  const context = Math.max(0, params.context ?? 0);
  const output = [];
  let matches = 0;
  let longLines = false;
  await walk(
    vm,
    root,
    async (guestPath, relativePath) => {
      if (matches >= limit || (params.glob && !matchesGlob(relativePath, params.glob))) return matches < limit;
      let contents;
      try {
        contents = await vm.fs.readFile(guestPath, { encoding: "utf8", signal });
      } catch {
        return true;
      }
      const lines = contents.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      for (let index = 0; index < lines.length && matches < limit; index++) {
        if (!match(lines[index] ?? "")) continue;
        matches++;
        for (
          let current = Math.max(0, index - context);
          current <= Math.min(lines.length - 1, index + context);
          current++
        ) {
          const truncated = truncateLine(lines[current] ?? "");
          longLines ||= truncated.wasTruncated;
          output.push(
            `${rootIsDirectory ? relativePath : path.posix.basename(guestPath)}${current === index ? ":" : "-"}${current + 1}${current === index ? ":" : "-"} ${truncated.text}`,
          );
        }
      }
      return matches < limit;
    },
    signal,
  );
  if (!matches) return { content: [{ type: "text", text: "No matches found" }], details: undefined };
  const truncation = truncateHead(output.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
  const notices = [];
  const details = {};
  if (matches >= limit) {
    notices.push(`${limit} matches limit reached`);
    details.matchLimitReached = limit;
  }
  if (longLines) {
    notices.push("long lines truncated");
    details.linesTruncated = true;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    details.truncation = truncation;
  }
  return {
    content: [{ type: "text", text: `${truncation.content}${notices.length ? `\n\n[${notices.join(". ")}]` : ""}` }],
    details: Object.keys(details).length ? details : undefined,
  };
}
