import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"));

test("required CI retains generic, QEMU and extension-load coverage; only explicit krun cases are experimental", () => {
  const required = workflow.jobs.test;
  assert.notEqual(required["continue-on-error"], true);
  assert.equal(required.env.HALL_VMM, "qemu");
  const command = required.steps.find((step) => step.name?.startsWith("Required tests")).run;
  assert.match(command, /--test-skip-pattern='\^krun: '/);
  for (const path of [
    "tests/crew/*.test.mjs",
    "tests/runtime/*.test.mjs",
    "tests/pi/*.test.mjs",
    "tests/github-armory-routing.test.mjs",
    "tests/github-pull-reviews.test.mjs",
    "bash tests/pi/test-extension-load.sh",
  ]) {
    assert.ok(command.includes(path), path);
  }
  assert.ok(!JSON.stringify(required).includes("HALL_SKIP_GONDOLIN_LIVE_TESTS"));
  assert.ok(required.steps.some((step) => step.run === "npm run format:check"));
});

test("experimental krun coverage still executes, records failures and cannot fail the required job", () => {
  const experimental = workflow.jobs["krun-experimental"];
  assert.equal(experimental["continue-on-error"], true);
  const command = experimental.steps.find((step) => step.name === "Run explicit krun coverage").run;
  assert.match(command, /set -o pipefail/);
  assert.match(command, /--test-name-pattern='\^krun: '/);
  for (const file of ["gondolin-worker-smoke", "gondolin-idle-release", "vm-lifecycle"]) {
    assert.ok(command.includes(`tests/runtime/${file}.test.mjs`));
  }
  assert.ok(!command.includes("|| true"));
  const artifact = experimental.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(artifact.if, "always()");
  assert.equal(artifact.with.path, "krun-experimental.tap");
});
