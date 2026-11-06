import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  populateRepositoryWorkspace,
  remoteMatchesRepository,
  repositorySeedPath,
  resolveRepositorySeed,
} from "../../extensions/crew/env-runtime/lib/repository-workspace.mjs";

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

test("a cache miss archives only from a matching origin and an available revision", () =>
  withCache((home, cached) => {
    const git = (origin, archived) => (_command, args) => {
      if (args.includes("config")) return origin;
      if (archived instanceof Error) throw archived;
      return archived;
    };
    const good = "https://github.com/MockaSort-Studio/pi-automata-crew.git";
    assert.throws(
      () =>
        resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: git("https://evil.example/x/y", null) }),
      /does not match the worker authorization/,
    );
    assert.throws(
      () => resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: git(good, new Error("bad object")) }),
      /revision is unavailable/,
    );
    assert.throws(
      () => resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: git(good, Buffer.alloc(100)) }),
      /invalid workspace seed/,
    );
    const seed = archive(globalHeader(authorization.revision), header("value", "fresh"));
    assert.equal(resolveRepositorySeed(authorization, { cwd: "/repo", home, execFile: git(good, seed) }), cached);
    assert.deepEqual(readFileSync(cached), seed);
  }));
