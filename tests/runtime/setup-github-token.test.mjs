import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("../../scripts/setup-github-token.sh", import.meta.url).pathname;
const token = "github_pat_ABC123_def456";

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "hall-token-"));
  const bin = join(dir, "bin");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho ${token}_fromgh\n`);
  chmodSync(join(bin, "gh"), 0o755);
  // A stand-in for GitHub: records the scopes header GitHub sends for a classic token.
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-D" ] && out="$2"; shift; done\nprintf 'x-oauth-scopes: gist, repo, workflow\\r\\n' > "$out"\necho 200\n`,
  );
  chmodSync(join(bin, "curl"), 0o755);
  return {
    dir,
    envFile: join(dir, "config", "hall", "env"),
    profile: join(dir, "zshrc"),
    run: (args, input = "") =>
      spawnSync("bash", [script, ...args], {
        input,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HALL_ENV_FILE: join(dir, "config", "hall", "env"), HALL_SHELL_PROFILE: join(dir, "zshrc") },
      }),
  };
}

test("a pasted token is stored privately, sourced once, and never printed", () => {
  const box = sandbox();
  try {
    const result = box.run(["--no-verify"], `${token}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(box.envFile, "utf8"), `export HALL_GITHUB_TOKEN='${token}'\n`);
    assert.equal(statSync(box.envFile).mode & 0o777, 0o600);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
    box.run(["--no-verify"], `${token}\n`);
    const profile = readFileSync(box.profile, "utf8");
    assert.equal(profile.split(box.envFile).length - 1, 2, "one guarded source line (mentions the path twice), added once");
  } finally {
    rmSync(box.dir, { recursive: true, force: true });
  }
});

test("--from-gh uses the current gh login only when asked", () => {
  const box = sandbox();
  try {
    assert.equal(box.run(["--from-gh", "--no-verify"]).status, 0);
    assert.match(readFileSync(box.envFile, "utf8"), /_fromgh'/);
  } finally {
    rmSync(box.dir, { recursive: true, force: true });
  }
});

test("a dry run writes nothing", () => {
  const box = sandbox();
  try {
    const result = box.run(["--dry-run", "--no-verify"], `${token}\n`);
    assert.equal(result.status, 0);
    assert.equal(existsSync(box.envFile), false);
    assert.equal(existsSync(box.profile), false);
    assert.match(result.stderr, /\[dry-run\]/);
  } finally {
    rmSync(box.dir, { recursive: true, force: true });
  }
});

test("input that is not a token, and unknown options, are refused", () => {
  const box = sandbox();
  try {
    assert.notEqual(box.run(["--no-verify"], "not a token with spaces\n").status, 0);
    assert.notEqual(box.run(["--bogus"]).status, 0);
    assert.equal(existsSync(box.envFile), false);
  } finally {
    rmSync(box.dir, { recursive: true, force: true });
  }
});

test("a broad classic token is accepted but flagged, matching GitHub's comma-and-space scope list", () => {
  const box = sandbox();
  try {
    const result = box.run([], `${token}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /classic scopes: gist,repo,workflow/);
    assert.match(result.stderr, /can write to repositories/);
  } finally {
    rmSync(box.dir, { recursive: true, force: true });
  }
});
