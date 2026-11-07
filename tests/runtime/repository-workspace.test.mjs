import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skipWithoutGit } from "./requires-git.mjs";
import {
  populateRepositoryWorkspace,
  remoteMatchesRepository,
  repositorySeedPath,
  resolveRepositorySeed,
  pruneRepositorySeeds,
} from "../../extensions/crew/env-runtime/lib/repository-workspace.mjs";
import { buildShallowCheckout } from "../../extensions/crew/env-runtime/lib/repository-seed-archive.mjs";

const authorization = { repo: "MockaSort-Studio/pi-automata-crew", revision: "a".repeat(40) };
const header = (name, content = "", type = "0") => {
  const value = Buffer.alloc(512);
  value.write(name);
  value.write("0000644\0", 100);
  value.write(`${Buffer.byteLength(content).toString(8).padStart(11, "0")}\0`, 124);
  value.write(type, 156);
  value.write("ustar", 257);
  return Buffer.concat([value, Buffer.from(content), Buffer.alloc((512 - (Buffer.byteLength(content) % 512)) % 512)]);
};
const archive = (...entries) => Buffer.concat([...entries, Buffer.alloc(1024)]);

const provider = () => {
  const files = new Map();
  return {
    files,
    mkdir: async () => {},
    writeFile: async (path, value) => files.set(path, Buffer.from(value).toString()),
    symlink: async (target, path) => files.set(path, `->${target}`),
  };
};

test("repository seed copies only archived revision content into a private provider", async () => {
  const workspace = provider();
  await populateRepositoryWorkspace(workspace, archive(header("src/", "", "5"), header("src/value.txt", "private")));
  assert.equal(workspace.files.get("/src/value.txt"), "private");
});

test("repository seed honors git archive pax headers without treating them as files", async () => {
  const workspace = provider();
  const long = `${"d/".repeat(60)}file.txt`;
  const record = (text) => `${text.length + 1 + String(text.length).length} ${text}\n`;
  const paxPath = record(`path=${long}`);
  await populateRepositoryWorkspace(
    workspace,
    archive(
      header("pax_global_header", "52 comment=abc\n", "g"),
      header("././@PaxHeader", paxPath, "x"),
      header("short", "deep"),
    ),
  );
  assert.deepEqual([...workspace.files], [[`/${long}`, "deep"]]);
  await assert.rejects(
    populateRepositoryWorkspace(provider(), archive(header("x", record("path=../escape"), "x"), header("ok", "no"))),
    /unsafe tar entry/,
  );
});

test("repository seed rejects traversal and malformed archives", async () => {
  await assert.rejects(populateRepositoryWorkspace(provider(), archive(header("../escape", "no"))), /unsafe tar entry/);
  await assert.rejects(populateRepositoryWorkspace(provider(), Buffer.alloc(512)), /missing its tar terminator/);
});

const globalHeader = (revision) => header("pax_global_header", `52 comment=${revision}\n`, "g");
const withCache = (use) => {
  const home = mkdtempSync(join(tmpdir(), "crew-seed-"));
  try {
    mkdirSync(join(home, ".cache", "pi-crew", "repositories"), { recursive: true, mode: 0o700 });
    return use(home, repositorySeedPath(authorization, home));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};
const noGit = () => {
  throw new Error("git must not run on a cache hit");
};

test("repository seed cache is keyed by exact repository and revision", () =>
  withCache((home, cached) => {
    writeFileSync(cached, archive(globalHeader(authorization.revision), header("value", "cached")), { mode: 0o600 });
    assert.equal(resolveRepositorySeed(authorization, { cwd: "/unused", home, execFile: noGit }), cached);
  }));

test("a cached seed naming another revision is rejected, not served", () =>
  withCache((home, cached) => {
    writeFileSync(cached, archive(globalHeader("b".repeat(40)), header("value", "poisoned")), { mode: 0o600 });
    assert.throws(
      () => resolveRepositorySeed(authorization, { cwd: "/unused", home, execFile: noGit }),
      /does not match its authorized revision/,
    );
  }));

test("a group/other-writable or foreign-owned cache is rejected on every resolution", () =>
  withCache((home, cached) => {
    writeFileSync(cached, archive(globalHeader(authorization.revision)), { mode: 0o600 });
    chmodSync(cached, 0o666);
    assert.throws(() => resolveRepositorySeed(authorization, { cwd: "/unused", home, execFile: noGit }), /not private/);
    chmodSync(cached, 0o600);
    assert.throws(
      () => resolveRepositorySeed(authorization, { cwd: "/unused", home, execFile: noGit, uid: 999_999 }),
      /not private/,
    );
  }));

test("only GitHub remotes for exactly the authorized repository are accepted", () => {
  for (const remote of [
    "https://github.com/MockaSort-Studio/pi-automata-crew.git",
    "https://github.com/mockasort-studio/pi-automata-crew",
    "git@github.com:MockaSort-Studio/pi-automata-crew.git",
    "ssh://git@github.com/MockaSort-Studio/pi-automata-crew.git\n",
  ])
    assert.equal(remoteMatchesRepository(remote, authorization.repo), true, remote);
  for (const remote of [
    "https://evil.example/MockaSort-Studio/pi-automata-crew.git",
    "https://github.com.evil.example/MockaSort-Studio/pi-automata-crew.git",
    "https://github.com/attacker/MockaSort-Studio/pi-automata-crew.git",
    "https://github.com/MockaSort-Studio/pi-automata-crew-fork.git",
    "/tmp/MockaSort-Studio/pi-automata-crew.git",
  ])
    assert.equal(remoteMatchesRepository(remote, authorization.repo), false, remote);
});

test("a cache miss builds only from a matching origin and an available revision", () =>
  withCache((home, cached) => {
    const origin = (url) => () => url;
    const good = origin("https://github.com/MockaSort-Studio/pi-automata-crew.git");
    const fail = () => {
      throw new Error("bad object");
    };
    assert.throws(
      () =>
        resolveRepositorySeed(authorization, {
          cwd: "/repo",
          home,
          execFile: origin("https://evil.example/x/y"),
          build: () => assert.fail("must not build"),
        }),
      /does not match the worker authorization/,
    );
    assert.throws(
      () => resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: good, build: fail }),
      /revision is unavailable/,
    );
    assert.throws(
      () =>
        resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: good, build: () => Buffer.alloc(100) }),
      /invalid workspace seed/,
    );
    const other = archive(globalHeader("b".repeat(40)));
    assert.throws(
      () => resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: good, build: () => other }),
      /different commit/,
    );
    const seed = archive(globalHeader(authorization.revision), header("value", "fresh"));
    assert.equal(
      resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: good, build: () => seed }),
      cached,
    );
    assert.deepEqual(readFileSync(cached), seed);
  }));

// A provider writing to a real directory, so host Git can inspect what a worker would receive.
const directoryProvider = (root) => ({
  mkdir: async (path) => mkdirSync(join(root, path), { recursive: true }),
  writeFile: async (path, data, { mode }) => writeFileSync(join(root, path), data, { mode }),
  symlink: async (target, path) => symlinkSync(target, join(root, path)),
});

test("a seed is a shallow Git checkout of exactly the revision, with a GitHub origin and no host leaks", async (t) => {
  if (skipWithoutGit(t)) return;
  const root = mkdtempSync(join(tmpdir(), "crew-seed-real-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", source]);
  mkdirSync(join(source, "deep/".repeat(30)), { recursive: true });
  writeFileSync(join(source, "deep/".repeat(30), "long.txt"), "long\n");
  writeFileSync(join(source, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  symlinkSync("run.sh", join(source, "link"));
  git(source, "add", ".");
  git(source, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one");
  writeFileSync(join(source, "run.sh"), "#!/bin/sh\necho two\n", { mode: 0o755 });
  git(source, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "two");
  const revision = git(source, "rev-parse", "HEAD");
  const seed = buildShallowCheckout({ cwd: source, repo: "owner/repo", revision });
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  await populateRepositoryWorkspace(directoryProvider(workspace), seed);
  assert.equal(git(workspace, "rev-parse", "HEAD"), revision);
  assert.equal(git(workspace, "rev-parse", "--is-shallow-repository"), "true");
  assert.equal(git(workspace, "status", "--porcelain"), "");
  assert.equal(git(workspace, "config", "--get", "remote.origin.url"), "https://github.com/owner/repo.git");
  assert.equal(readFileSync(join(workspace, "deep/".repeat(30), "long.txt"), "utf8"), "long\n");
  for (const leak of ["hooks", "logs", "FETCH_HEAD"])
    assert.equal(existsSync(join(workspace, ".git", leak)), false, leak);
  assert.doesNotMatch(readFileSync(join(workspace, ".git", "config"), "utf8"), new RegExp(source));
});

test("the seed cache keeps the most recently used archives and never touches anything else", () => {
  const root = mkdtempSync(join(tmpdir(), "seed-prune-"));
  try {
    const name = (i) => `${String(i).padStart(64, "0")}.tar`;
    for (let i = 0; i < 14; i += 1) {
      writeFileSync(join(root, name(i)), "x");
      utimesSync(join(root, name(i)), new Date(2026, 0, 1, 0, i), new Date(2026, 0, 1, 0, i)); // 0 is the oldest
    }
    writeFileSync(join(root, "notes.txt"), "not a seed");
    writeFileSync(join(root, `${name(1)}.123.tmp`), "a build in progress");
    const inUse = join(root, name(0)); // the oldest, but in use right now

    pruneRepositorySeeds(root, { keep: 10, protect: inUse });
    const left = readdirSync(root).sort();
    assert.ok(left.includes(name(0)), "the archive in use survives even though it is the oldest");
    for (const i of [1, 2, 3]) assert.ok(!left.includes(name(i)), `old archive ${i} was pruned`);
    for (const i of [4, 13]) assert.ok(left.includes(name(i)), `recent archive ${i} was kept`);
    assert.ok(
      left.includes("notes.txt") && left.includes(`${name(1)}.123.tmp`),
      "files that are not seed archives are untouched",
    );
    assert.equal(
      left.filter((file) => /^[0-9a-f]{64}\.tar$/.test(file)).length,
      11,
      "ten most recent plus the one in use",
    );
    pruneRepositorySeeds(join(root, "missing")); // housekeeping never throws
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
