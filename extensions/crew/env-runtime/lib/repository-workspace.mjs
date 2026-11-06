import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildShallowCheckout } from "./repository-seed-archive.mjs";

const BLOCK = 512;
const safePath = (value) =>
  typeof value === "string" && value && !value.startsWith("/") && !value.split("/").includes("..");

export const repositorySeedCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "repositories");
// The format is part of the key: a seed is a shallow checkout with .git, unlike earlier seeds.
const SEED_FORMAT = "pi-crew-repository-seed/v2";
export const repositorySeedKey = ({ repo, revision }) =>
  createHash("sha256").update(`${SEED_FORMAT}\0${repo}\0${revision}`).digest("hex");
export const repositorySeedPath = (authorization, home) =>
  join(repositorySeedCacheRoot(home), `${repositorySeedKey(authorization)}.tar`);

// Only GitHub's own HTTPS/SSH remote forms for exactly this owner/repo are accepted.
const GITHUB_REMOTE =
  /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i;
export function remoteMatchesRepository(origin, repo) {
  const match = GITHUB_REMOTE.exec(String(origin).trim());
  return Boolean(match) && match[1].toLowerCase() === repo.toLowerCase();
}

function assertSourceRepository(cwd, repo, execFile) {
  let origin;
  try {
    origin = execFile("git", ["-C", cwd, "config", "--get", "remote.origin.url"], { encoding: "utf8" });
  } catch {
    throw new Error("Repository seed source has no origin remote");
  }
  if (!remoteMatchesRepository(origin, repo))
    throw new Error("Repository seed source does not match the worker authorization");
}

// The cache is trusted only while it is private to this user: every resolution, not only
// creation, rejects a symlinked, foreign-owned, or group/other-writable directory or entry.
function assertPrivate(path, lstat, uid) {
  const info = lstat(path);
  if (info.isSymbolicLink() || (uid !== undefined && info.uid !== uid) || info.mode & 0o022)
    throw new Error(`Repository seed cache is not private to this user: ${path}`);
}

// A seed's pax global header records its commit id (as git archive does); a cached seed must name its key's revision.
export function archiveRevision(archive) {
  const header = archive.subarray(0, BLOCK);
  if (header.subarray(156, 157).toString() !== "g") return undefined;
  const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, "").trim() || "0", 8);
  return /(?:^|\n)\d+ comment=([0-9a-f]{40})\n/.exec(archive.subarray(BLOCK, BLOCK + size).toString())?.[1];
}

export function resolveRepositorySeed(
  authorization,
  {
    cwd,
    home,
    exists = existsSync,
    execFile = execFileSync,
    build = buildShallowCheckout,
    lstat = lstatSync,
    uid = process.getuid?.(),
  } = {},
) {
  if (!authorization) return undefined;
  const path = repositorySeedPath(authorization, home);
  const root = dirname(path);
  if (exists(root)) assertPrivate(root, lstat, uid);
  if (exists(path)) {
    assertPrivate(path, lstat, uid);
    if (archiveRevision(readFileSync(path)) !== authorization.revision.toLowerCase())
      throw new Error("Repository seed cache does not match its authorized revision");
    return path;
  }
  assertSourceRepository(cwd, authorization.repo, execFile);
  let archive;
  try {
    archive = build({ cwd, repo: authorization.repo, revision: authorization.revision });
  } catch {
    throw new Error("Authorized repository revision is unavailable for the worker workspace");
  }
  if (!Buffer.isBuffer(archive) || archive.length < BLOCK || archive.length % BLOCK)
    throw new Error("Authorized repository revision produced an invalid workspace seed");
  if (archiveRevision(archive) !== authorization.revision.toLowerCase())
    throw new Error("Authorized repository revision produced a seed for a different commit");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  assertPrivate(root, lstat, uid);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, archive, { mode: 0o600 });
  try {
    renameSync(temporary, path);
  } catch (error) {
    if (!exists(path)) throw error;
  }
  return path;
}

const field = (header, start, length) =>
  header
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/, "");
const octal = (header, start, length) => {
  const value = field(header, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("Repository seed contains an invalid tar header");
  return value ? Number.parseInt(value, 8) : 0;
};

export async function populateRepositoryWorkspace(provider, archive) {
  const bytes = Buffer.isBuffer(archive) ? archive : readFileSync(archive);
  let paxPath;
  for (let offset = 0; offset + BLOCK <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      if (
        offset + BLOCK * 2 <= bytes.length &&
        bytes.subarray(offset + BLOCK, offset + BLOCK * 2).every((byte) => byte === 0)
      )
        return;
      throw new Error("Repository seed archive is missing its tar terminator");
    }
    const size = octal(header, 124, 12);
    const type = field(header, 156, 1) || "0";
    const ustarName = `${field(header, 345, 155) ? `${field(header, 345, 155)}/` : ""}${field(header, 0, 100)}`;
    const name = paxPath ?? ustarName;
    const target = field(header, 157, 100);
    // The pax global header carries the commit id; pax records carry no file content.
    if (type === "g" || type === "x") {
      if (type === "x")
        paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(
          bytes.subarray(offset + BLOCK, offset + BLOCK + size).toString("utf8"),
        )?.[1];
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (!safePath(name) || size < 0 || offset + BLOCK + size > bytes.length)
      throw new Error("Repository seed contains an unsafe tar entry");
    const targetPath = `/${name.replace(/\/$/, "")}`;
    if (type === "5") await provider.mkdir(targetPath, { recursive: true });
    else if (type === "0") {
      await provider.mkdir(dirname(targetPath), { recursive: true });
      await provider.writeFile(targetPath, bytes.subarray(offset + BLOCK, offset + BLOCK + size), {
        mode: octal(header, 100, 8) || 0o644,
      });
    } else if (type === "2") {
      if (!safePath(target)) throw new Error("Repository seed contains an unsafe symlink");
      await provider.mkdir(dirname(targetPath), { recursive: true });
      await provider.symlink(target, targetPath);
    } else throw new Error("Repository seed contains an unsupported tar entry");
    paxPath = undefined;
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error("Repository seed archive is missing its tar terminator");
}

export async function seedRepositoryWorkspace(provider, authorization, options) {
  const archive = resolveRepositorySeed(authorization, options);
  if (archive) await populateRepositoryWorkspace(provider, archive);
}
