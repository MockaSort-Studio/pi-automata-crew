#!/usr/bin/env node
// Prints the CHANGELOG section for one version (`node scripts/release-notes.mjs 0.1.0`): everything under its
// `## [version]` heading up to the next `## ` heading. Fails if the version has no section, so a release cannot
// go out with empty notes.
import { readFileSync } from "node:fs";

export function releaseNotes(changelog, version) {
  const heading = new RegExp(`^## \\[${version.replace(/[.+*?^${}()|[\]\\]/g, "\\$&")}\\][^\\n]*$`, "m");
  const start = heading.exec(changelog);
  if (!start) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const rest = changelog.slice(start.index + start[0].length);
  const next = rest.search(/^## /m);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  if (!body) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return `${body}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(
      releaseNotes(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), process.argv[2] ?? ""),
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
