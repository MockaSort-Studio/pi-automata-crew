import { readFileSync } from "node:fs";
import { repositoryAuthorization } from "./repository-authorization.mjs";

const STORE_PATH = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/;

// This is trusted worker-runtime configuration, not model tool data. It is
// deliberately limited to exact mount paths and operation grants; suite code,
// flake locators, credentials, and descriptors are not read here.
export function workerArmoryConfig(config) {
  const authorization = repositoryAuthorization(config?.repositoryAuthorization);
  const armory = config?.armory;
  if (!armory)
    return {
      paths: [],
      suites: [],
      network: undefined,
      ...(authorization ? { repositoryAuthorization: authorization } : {}),
    };
  const paths = armory.nixPaths ?? [];
  const suites = armory.suites ?? [];
  const network = armory.network;
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length || !paths.every((path) => STORE_PATH.test(path)))
    throw new Error("Worker Armory config has invalid Nix mount paths");
  if (
    !Array.isArray(suites) ||
    suites.some(
      (suite) =>
        !paths.includes(suite.rootPath) ||
        !Array.isArray(suite.tools) ||
        suite.tools.some((tool) => typeof tool !== "string" || !tool),
    )
  )
    throw new Error("Worker Armory config has invalid suite operation grants");
  // The host computes the union of granted suite hosts. The guest receives only
  // that allowlist and credential bindings, never a suite manifest or locator.
  if (
    network &&
    (!Array.isArray(network.allowedHosts) ||
      network.allowedHosts.some((host) => typeof host !== "string" || !host) ||
      !Array.isArray(network.credentials) ||
      network.credentials.some(
        (credential) =>
          typeof credential?.environment !== "string" || !credential.environment || !Array.isArray(credential.hosts),
      ))
  )
    throw new Error("Worker Armory config has invalid network policy");
  return {
    paths,
    suites: suites.map((suite) => ({ rootPath: suite.rootPath, tools: [...new Set(suite.tools)] })),
    ...(authorization ? { repositoryAuthorization: authorization } : {}),
    network: network && {
      allowedHosts: [...new Set(network.allowedHosts)].sort(),
      credentials: network.credentials.map((credential) => ({ ...credential, hosts: [...new Set(credential.hosts)] })),
    },
  };
}

export function readWorkerArmoryConfig(path = process.env.PI_CREW_WORKER_CONFIG) {
  if (!path) return { paths: [], suites: [] };
  return workerArmoryConfig(JSON.parse(readFileSync(path, "utf8")));
}
