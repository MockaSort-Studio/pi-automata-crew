import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BLOCK = 512;
const safePath = (value) =>
  typeof value === "string" && value && !value.startsWith("/") && !value.split("/").includes("..");

export const repositorySeedCacheRoot = (home = homedir()) => join(home, ".cache", "pi-crew", "repositories");
export const repositorySeedKey = ({ repo, revision }) =>
  createHash("sha256").update(`${repo}\0${revision}`).digest("hex");
export const repositorySeedPath = (authorization, home) =>
  join(repositorySeedCacheRoot(home), `${repositorySeedKey(authorization)}.tar`);

function assertSourceRepository(cwd, repo, execFile = execFileSync) {
  const origin = String(
    execFile("git", ["-C", cwd, "config", "--get", "remote.origin.url"], { encoding: "utf8" }),
  ).trim();
  if (!origin.endsWith(`/${repo}.git`) && !origin.endsWith(`/${repo}`))
    throw new Error("Repository seed source does not match the worker authorization");
}

export function resolveRepositorySeed(authorization, { cwd, home, exists = existsSync, execFile = execFileSync } = {}) {
  if (!authorization) return undefined;
  const path = repositorySeedPath(authorization, home);
  if (exists(path)) return path;
  assertSourceRepository(cwd, authorization.repo, execFile);
  let archive;
  try {
    archive = execFile("git", ["-C", cwd, "archive", "--format=tar", authorization.revision], {
      encoding: "buffer",
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch {
    throw new Error("Authorized repository revision is unavailable for the worker workspace");
  }
  if (!Buffer.isBuffer(archive) || archive.length < BLOCK || archive.length % BLOCK)
    throw new Error("Authorized repository revision produced an invalid workspace seed");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
    // git archive writes a pax global header (commit id); pax records carry no file content.
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
