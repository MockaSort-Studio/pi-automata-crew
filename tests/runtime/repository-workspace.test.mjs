import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  populateRepositoryWorkspace,
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

test("repository seed cache is keyed by exact repository and revision", () => {
  const home = mkdtempSync(join(tmpdir(), "crew-seed-"));
  try {
    const cached = repositorySeedPath(authorization, home);
    mkdirSync(join(home, ".cache", "pi-crew", "repositories"), { recursive: true });
    writeFileSync(cached, archive(header("value", "cached")));
    let executed = false;
    assert.equal(
      resolveRepositorySeed(authorization, {
        cwd: "/unused",
        home,
        execFile: () => {
          executed = true;
        },
      }),
      cached,
    );
    assert.equal(executed, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
