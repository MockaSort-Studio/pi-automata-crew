import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { releaseNotes } from "../../scripts/release-notes.mjs";

const root = new URL("../../", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

test("the published tarball has what Pi loads and nothing it should not ship", () => {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }),
  );
  const files = packed[0].files.map((file) => file.path);
  for (const needed of [
    "package.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "SPECIALIST_ROUTES",
    "extensions/crew.ts",
    "skills/engineering-execution/SKILL.md",
  ])
    assert.ok(files.includes(needed), `${needed} is shipped`);
  for (const path of files)
    assert.doesNotMatch(path, /^(tests|\.pi|\.github|scripts|node_modules)\//, `${path} must not be shipped`);
  assert.ok(
    files.some((path) => path.startsWith("extensions/crew/runner/")),
    "the crew host is shipped",
  );
});

test("the package declares its license and where it lives, and the license text is GPL-3.0", () => {
  assert.equal(pkg.name, "@mockasort-studio/pi-automata-crew");
  assert.equal(pkg.license, "GPL-3.0-only");
  assert.match(pkg.repository.url, /MockaSort-Studio\/pi-automata-crew/);
  const license = readFileSync(new URL("../../LICENSE", import.meta.url), "utf8");
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.equal(license.length, 35149, "the verbatim FSF text");
});

test("release notes come from the changelog section of that version, and a missing or empty one is an error", () => {
  const changelog =
    "# Changelog\n\n## [Unreleased]\n\nnext\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- a thing\n\n## [0.0.9] - 2025-12-01\n\n- old\n";
  assert.equal(releaseNotes(changelog, "0.1.0"), "### Added\n\n- a thing\n");
  assert.equal(releaseNotes(changelog, "0.0.9"), "- old\n");
  assert.throws(() => releaseNotes(changelog, "0.2.0"), /no section for 0\.2\.0/);
  assert.throws(() => releaseNotes("## [1.0.0]\n\n## [0.9.0]\n- x\n", "1.0.0"), /is empty/);
  assert.throws(() => releaseNotes("## [1x0x0]\n- x\n", "1.0.0"), /no section/, "the dots are literal");
});
