import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("../../scripts/setup-env.sh", import.meta.url).pathname;
const run = (conf, ...args) =>
  execFileSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, NIX_CUSTOM_CONF: conf } });

test("dry run plans the cache entry and a daemon restart without changing anything", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-env-"));
  try {
    const conf = join(dir, "nix.custom.conf");
    const output = run(conf, "--dry-run");
    assert.match(output, /extra-substituters = https:\/\/hall-armory\.cachix\.org/);
    assert.match(output, /extra-trusted-public-keys = hall-armory\.cachix\.org-1:/);
    assert.match(output, /\[dry-run\] sudo (launchctl|systemctl)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nothing to do once the cache is configured and Nix is present", () => {
  const dir = mkdtempSync(join(tmpdir(), "setup-env-"));
  try {
    const conf = join(dir, "nix.custom.conf");
    writeFileSync(conf, "extra-substituters = https://hall-armory.cachix.org\n");
    assert.match(run(conf, "--dry-run"), /already configured/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects unknown options", () => {
  assert.throws(() => run("/dev/null", "--bogus"), /unknown option|Command failed/);
});
