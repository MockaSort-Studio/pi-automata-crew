import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"));
const root = fileURLToPath(new URL("../../", import.meta.url));
const PAIRED_CASES = [
  "a VM does not outlive a SIGKILLed owner, and a closed VM leaves nothing behind",
  "an idle worker releases its VM and boots a fresh one on the next tool call",
  "an owner killed while its VM is still booting leaks nothing",
  "the registered Gondolin worker extension routes Pi's built-in bash through the guest",
];
// Every test file the required CI command runs (its globs are asserted below).
const requiredTestFiles = () => [
  ...["tests/crew", "tests/runtime", "tests/pi"].flatMap((dir) =>
    readdirSync(new URL(`../../${dir}/`, import.meta.url))
      .filter((name) => name.endsWith(".test.mjs"))
      .map((name) => `${dir}/${name}`),
  ),
];

test("the krun-named cases excluded from required CI are exactly the four paired backend cases", () => {
  const runtime = new URL("../runtime/", import.meta.url);
  const names = [];
  for (const file of readdirSync(runtime).filter((name) => name.endsWith(".test.mjs"))) {
    const source = readFileSync(new URL(file, runtime), "utf8");
    for (const match of source.matchAll(/test\(\s*`\$\{vmm\}: ([^`]+)`/g)) {
      names.push(match[1]);
      assert.ok(source.includes('"krun"') && source.includes('"qemu"'), `${file} must retain both backends`);
    }
    assert.ok(!/test\(\s*["'`]krun: /.test(source), `${file}: unexpected unpaired krun case`);
  }
  assert.deepEqual(names.sort(), [...PAIRED_CASES].sort());
});

// Required CI skips every test whose title starts with "krun: ", so renaming a failing test that way would turn
// CI green without anyone being asked. The titles are taken from the files themselves, as registered, not from
// how their source spells them; a string literal starting "krun: " anywhere else (a subtest) is refused too.
test("the only test titles required CI skips are the four paired krun cases", () => {
  const files = requiredTestFiles();
  const dir = mkdtempSync(join(tmpdir(), "crew-titles-"));
  const out = join(dir, "titles.json");
  let output;
  try {
    execFileSync(process.execPath, ["tests/crew/test-titles.mjs", out, ...files], { cwd: root, timeout: 90_000 });
    output = readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const { titles, unloadable } = JSON.parse(output);
  assert.deepEqual(unloadable, [], "every required test file must register its tests");
  const skipped = new RegExp("^krun: ");
  assert.deepEqual(
    titles.filter((title) => skipped.test(title)).sort(),
    PAIRED_CASES.map((name) => `krun: ${name}`).sort(),
  );
  for (const name of PAIRED_CASES) assert.ok(titles.includes(`qemu: ${name}`), `qemu: ${name}`);
  // This file states the policy itself and is excluded from the literal scan (its titles are enumerated above).
  for (const file of files.filter((name) => name !== "tests/crew/ci-backend-policy.test.mjs")) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.ok(!/["'`]krun: /.test(source), `${file}: a "krun: " title literal is skipped by required CI`);
  }
});

test("required CI retains generic, QEMU and extension-load coverage and is the only job; only explicit krun cases are excluded", () => {
  assert.deepEqual(Object.keys(workflow.jobs), ["test"]);
  const required = workflow.jobs.test;
  assert.notEqual(required["continue-on-error"], true);
  assert.equal(required.env.HALL_VMM, "qemu");
  const command = required.steps.find((step) => step.name?.startsWith("Required tests")).run;
  assert.ok(command.includes('export PATH="$PWD/node_modules/.bin:$PATH"'));
  assert.match(command, /--test-skip-pattern='\^krun: '/);
  for (const path of [
    "tests/crew/*.test.mjs",
    "tests/runtime/*.test.mjs",
    "tests/pi/*.test.mjs",
    "bash tests/pi/test-extension-load.sh",
  ]) {
    assert.ok(command.includes(path), path);
  }
  // Node silently ignores a missing path, so a deleted test file would vanish from CI unnoticed: every
  // test path named by the CI command and by `npm run test:suite` must exist (globs must match a file).
  const suite = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).scripts["test:suite"];
  for (const text of [command, suite]) {
    for (const [path] of text.matchAll(/tests\/[^\s]+/g)) {
      const dir = new URL(`../../${path.slice(0, path.lastIndexOf("/") + 1)}`, import.meta.url);
      const base = path.slice(path.lastIndexOf("/") + 1);
      const pattern = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      assert.ok(existsSync(dir) && readdirSync(dir).some((name) => pattern.test(name)), `${path} matches no file`);
    }
  }
  assert.equal(
    suite.match(/tests\/\S+\.test\.mjs/g).join(" "),
    command.match(/tests\/\S+\.test\.mjs/g).join(" "),
    "package.json test:suite and CI run the same test files",
  );
  assert.ok(!JSON.stringify(required).includes("HALL_SKIP_GONDOLIN_LIVE_TESTS"));
  assert.ok(required.steps.some((step) => step.run === "npm run format:check"));
});
