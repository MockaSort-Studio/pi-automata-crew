import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BLOCK = 512;

// Host Git runs with no system or user configuration, so a user's hooks, filters (LFS smudge),
// credential helpers or URL rewrites never act on the worker's seed.
const isolatedGit = (execFile, args, options = {}) =>
  execFile("git", args, {
    encoding: "utf8",
    ...options,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });

function header(name, { size = 0, mode = 0o644, type = "0", target = "" }) {
  const block = Buffer.alloc(BLOCK);
  block.write(name.slice(0, 100), 0);
  block.write(`${mode.toString(8).padStart(7, "0")}\0`, 100);
  block.write("0000000\0", 108);
  block.write("0000000\0", 116);
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  block.write("00000000000\0", 136);
  block.write("        ", 148);
  block.write(type, 156);
  block.write(target.slice(0, 100), 157);
  block.write("ustar\u000000", 257);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}
const padded = (data) => Buffer.concat([data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)]);
const paxRecord = (key, value) => {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (`${length}${body}`.length !== length) length += 1;
  return `${length}${body}`;
};

function entry(name, options, data = Buffer.alloc(0)) {
  const parts = [];
  if (Buffer.byteLength(name) > 100) {
    const pax = Buffer.from(paxRecord("path", name));
    parts.push(header("pax-header", { size: pax.length, type: "x" }), padded(pax));
  }
  parts.push(header(name, { ...options, size: data.length }), padded(data));
  return parts;
}

// A ustar archive of one directory, led by the same pax global `comment=<revision>` record
// `git archive` writes, so a cached seed can be checked against its authorized revision.
export function writeSeedArchive(root, revision) {
  const comment = Buffer.from(paxRecord("comment", revision));
  const parts = [header("pax_global_header", { size: comment.length, type: "g" }), padded(comment)];
  const walk = (relative) => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const info = lstatSync(join(root, path));
      if (info.isSymbolicLink()) parts.push(...entry(path, { type: "2", target: readlinkSync(join(root, path)) }));
      else if (info.isDirectory()) {
        parts.push(...entry(`${path}/`, { type: "5", mode: 0o755 }));
        walk(path);
      } else if (info.isFile()) parts.push(...entry(path, { mode: info.mode & 0o777 }, readFileSync(join(root, path))));
    }
  };
  walk("");
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

// A shallow, detached checkout of exactly one revision with a GitHub origin, built from the
// local repository without network access. Typed Git operations in the guest create the worker
// branch from it; no host path, reflog or hook is carried into the worker.
export function buildShallowCheckout({ cwd, repo, revision, execFile = execFileSync }) {
  const directory = mkdtempSync(join(tmpdir(), "pi-crew-seed-"));
  try {
    isolatedGit(execFile, ["init", "-q", directory]);
    isolatedGit(execFile, [
      "-C",
      directory,
      "-c",
      "protocol.version=2",
      "fetch",
      "-q",
      "--depth",
      "1",
      `file://${cwd}`,
      revision,
    ]);
    isolatedGit(execFile, [
      "-C",
      directory,
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "-q",
      "--detach",
      "FETCH_HEAD",
    ]);
    isolatedGit(execFile, ["-C", directory, "remote", "add", "origin", `https://github.com/${repo}.git`]);
    if (String(isolatedGit(execFile, ["-C", directory, "rev-parse", "HEAD"])).trim() !== revision.toLowerCase())
      throw new Error("Repository seed checkout is not at the authorized revision");
    for (const leak of ["hooks", "logs", "FETCH_HEAD", "description"])
      rmSync(join(directory, ".git", leak), { recursive: true, force: true });
    return writeSeedArchive(directory, revision.toLowerCase());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
