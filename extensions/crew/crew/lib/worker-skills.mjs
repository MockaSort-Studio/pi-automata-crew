import { readFileSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILLS = 4;
const MAX_BYTES = 24_000;

// Workers deliberately disable project skill discovery. Main reads only explicitly requested, bounded
// skill files and embeds them in the worker instruction instead of giving a worker filesystem discovery.
export function requiredWorkerSkills(cwd, names) {
  if (names === undefined) return { names: [], text: "" };
  if (!Array.isArray(names) || names.length > MAX_SKILLS)
    throw new TypeError(`A worker may require at most ${MAX_SKILLS} skills.`);
  const unique = [...new Set(names)];
  if (unique.some((name) => typeof name !== "string" || !NAME.test(name)))
    throw new TypeError("Invalid worker skill name.");
  const sections = unique.map((name) => {
    const source = readFileSync(join(cwd, "skills", name, "SKILL.md"), "utf8");
    return `### ${name}\n${source}`;
  });
  const text = sections.length
    ? `## REQUIRED SKILLS\nFollow these supplied procedures. Do not search for project skills.\n\n${sections.join("\n\n")}`
    : "";
  if (Buffer.byteLength(text) > MAX_BYTES) throw new RangeError(`Worker skills exceed the ${MAX_BYTES}-byte limit.`);
  return { names: unique, text };
}
