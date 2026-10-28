const SUITE_FORMAT = "hall.armory-suite/v1";

const requiredString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Armory ${label} is required`);
  return value;
};

function validateNetwork(value) {
  if (value === undefined) return undefined;
  if (!value || !Array.isArray(value.allowedHosts) || value.allowedHosts.some((host) => typeof host !== "string" || !host))
    throw new Error("Armory network policy is invalid");
  const credentials = value.credentials ?? [];
  if (!Array.isArray(credentials) || credentials.some((item) => typeof item?.environment !== "string" || !item.environment || !Array.isArray(item.hosts) || item.hosts.some((host) => typeof host !== "string" || !host)))
    throw new Error("Armory credential policy is invalid");
  return { allowedHosts: [...new Set(value.allowedHosts)], credentials: credentials.map((item) => ({ environment: item.environment, hosts: [...new Set(item.hosts)] })) };
}

function validatePackage(value) {
  if (!value || typeof value !== "object") throw new Error("Armory package is required");
  return {
    name: requiredString(value.name, "package name"),
    version: requiredString(value.version, "package version"),
    integrity: requiredString(value.integrity, "package integrity"),
  };
}

export function validateArmorySuite(suite, requestedTools) {
  if (suite?.format !== SUITE_FORMAT) throw new Error("Unsupported Armory suite manifest format");
  requiredString(suite.extension, "extension");
  const closure = requiredString(suite.native?.closure, "native Nix closure");
  const output = requiredString(suite.native?.output, "native Nix output");
  if (!Array.isArray(suite.tools) || !suite.tools.every((tool) => typeof tool === "string" && tool))
    throw new Error(`Armory suite ${suite.extension} has an invalid tool allowlist`);
  const tools = requestedTools ?? suite.tools;
  if (!Array.isArray(tools) || tools.some((tool) => !suite.tools.includes(tool)))
    throw new Error(`Armory suite ${suite.extension} was requested with undeclared tools`);
  return { ...suite, package: validatePackage(suite.package), native: { closure, output }, network: validateNetwork(suite.network), tools: [...new Set(tools)] };
}
