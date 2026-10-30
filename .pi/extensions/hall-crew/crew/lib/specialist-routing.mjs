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

export function routeSpecialists(paths, routes, maxSpecialists = 3) {
  if (!Array.isArray(paths) || !Number.isInteger(maxSpecialists) || maxSpecialists < 1)
    throw new TypeError("Paths and a positive specialist limit are required.");
  const matches = paths
    .map((value) => {
      const path = pathOf(value);
      const route = routes.filter((candidate) => candidate.matcher.test(path)).at(-1);
      return route && { path, rule: { line: route.line, pattern: route.pattern }, specialists: route.specialists };
    })
    .filter(Boolean);
  return {
    specialists: [...new Set(matches.flatMap((match) => match.specialists))].slice(0, maxSpecialists),
    matches,
  };
}
