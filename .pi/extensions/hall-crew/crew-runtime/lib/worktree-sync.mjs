import { execFile } from "node:child_process";
import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Makes a fresh detached worktree match the caller's working tree: tracked changes as a patch,
// untracked files copied, and the extensions always present (workers load them from here).
export async function syncWorkingTree(cwd, runRoot, worktree) {
  const patch = await exec("git", ["diff", "--binary", "HEAD"], { cwd, maxBuffer: 4 * 1024 * 1024 });
  if (patch.stdout) {
    const patchFile = join(runRoot, "working-tree.patch");
    await writeFile(patchFile, patch.stdout);
    await exec("git", ["apply", patchFile], { cwd: worktree, timeout: 30_000 });
  }
  const untracked = await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd });
  await Promise.all([
    ...untracked.stdout
      .split("\n")
      .filter(Boolean)
      .map((path) => cp(join(cwd, path), join(worktree, path), { recursive: true })),
    cp(join(cwd, ".pi", "extensions"), join(worktree, ".pi", "extensions"), { recursive: true }),
  ]);
}
