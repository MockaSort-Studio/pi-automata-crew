import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const OWNERS = /^@([a-z0-9][a-z0-9-]*)$/i;

function glob(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("?", "[^/]").replaceAll("\u0000", ".*")}$`,
  );
}

function pathOf(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes(".."))
    throw new TypeError(`Route path must be a relative repository path: ${path}`);
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

// Routing policy belongs to the checked-out repository, never the installed package or .pi state.
export function specialistRoutesPath(cwd) {
  let directory = resolve(cwd);
  while (true) {
    if (existsSync(join(directory, ".git"))) {
      const policy = join(directory, "SPECIALIST_ROUTES");
      if (existsSync(policy)) return policy;
      throw new Error(`Repository routing policy is missing: ${policy}`);
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Unable to locate repository root from: ${cwd}`);
    directory = parent;
  }
}

export function parseSpecialistRoutes(source) {
  return source.split("\n").flatMap((line, index) => {
    const fields = line.trim().split(/\s+/).filter(Boolean);
    if (!fields.length || fields[0].startsWith("#")) return [];
    const [pattern, ...owners] = fields;
    if (!pattern?.startsWith("/") || !owners.length || owners.some((owner) => !OWNERS.test(owner)))
      throw new TypeError(`Invalid specialist route at line ${index + 1}`);
    return [
      { line: index + 1, pattern, matcher: glob(pattern.slice(1)), specialists: owners.map((owner) => owner.slice(1)) },
    ];
  });
}

function bounded(result) {
  if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw new RangeError("Routing output exceeds limit.");
  return result;
}

export function discoverSpecialistRoutes(routes, roster) {
  const rules = routes.map(({ line, pattern, specialists }) => ({ line, pattern, specialists }));
  const names = [...new Set(rules.flatMap((rule) => rule.specialists))];
  const specialists = names.map((name) => ({ name, domains: roster.automata[name]?.domains ?? null }));
  return bounded({ rules, specialists });
}

export function routeSpecialists(paths, routes, maxSpecialists = 3) {
  if (!Array.isArray(paths) || !Number.isInteger(maxSpecialists) || maxSpecialists < 1)
    throw new TypeError("Paths and a positive specialist limit are required.");
  const matches = [];
  const unmatchedPaths = [];
  for (const value of paths) {
    const path = pathOf(value);
    const route = routes.filter((candidate) => candidate.matcher.test(path)).at(-1);
    if (route) matches.push({ path, rule: { line: route.line, pattern: route.pattern }, specialists: route.specialists });
    else unmatchedPaths.push(path);
  }
  return bounded({
    specialists: [...new Set(matches.flatMap((match) => match.specialists))].slice(0, maxSpecialists),
    matches,
    unmatchedPaths,
  });
}
