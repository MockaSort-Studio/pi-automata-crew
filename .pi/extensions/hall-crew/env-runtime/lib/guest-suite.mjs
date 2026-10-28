import { randomUUID } from "node:crypto";
import { readWorkerArmoryConfig } from "./worker-armory-config.mjs";

const STORE_PATH = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/;
const validName = (value) => typeof value === "string" && value.length > 0;

function assertRunner(rootPath, operations) {
  if (!STORE_PATH.test(rootPath)) throw new Error("Guest suite runner requires a Nix store output path");
  if (!Array.isArray(operations) || !operations.length || new Set(operations).size !== operations.length || !operations.every(validName))
    throw new Error("Guest suite runner requires unique approved operations");
  return `${rootPath}/bin/armory-suite`;
}

function parseResult(content) {
  const result = JSON.parse(content);
  if (!result || typeof result !== "object") throw new Error("Guest suite runner returned invalid JSON");
  if (result.error?.message) throw new Error(`Guest suite runner failed: ${result.error.message}`);
  return result;
}

// Env's generic, file-based bridge to one Nix-built guest suite. The caller
// supplies a worker-private guest and authorization projection; no suite code
// runs or is imported on the host.
export function createGuestSuiteRunner({ guest, rootPath, operations, uuid = randomUUID }) {
  if (!guest?.fs?.writeFile || !guest?.fs?.readFile || !guest.exec)
    throw new Error("Guest suite runner requires a guest filesystem and executor");
  const executable = assertRunner(rootPath, operations);
  const allowed = new Set(operations);

  async function request(mode, body) {
    const id = uuid();
    const directory = `/tmp/hall-armory/${id}`;
    const input = `${directory}/input.json`;
    const output = `${directory}/output.json`;
    await guest.exec(["/bin/mkdir", "-p", directory]);
    try {
      await guest.fs.writeFile(input, JSON.stringify({ operations, ...body }), { encoding: "utf8", mode: 0o600 });
      const completed = await guest.exec([executable, mode, input, output]);
      const result = parseResult(await guest.fs.readFile(output, { encoding: "utf8" }));
      if (completed.exitCode !== 0) throw new Error("Guest suite runner failed without an error envelope");
      return result;
    } finally {
      await guest.exec(["/bin/rm", "-rf", directory]).catch(() => undefined);
    }
  }

  return {
    async describe() {
      const result = await request("describe", {});
      if (!Array.isArray(result.operations) || result.operations.some((item) => !allowed.has(item?.name)))
        throw new Error("Guest suite runner described an unapproved operation");
      return result.operations;
    },
    async invoke(operation, input) {
      if (!allowed.has(operation)) throw new Error(`Guest operation is not approved: ${operation}`);
      const result = await request("invoke", { operation, input });
      if (!("result" in result)) throw new Error("Guest suite runner omitted its result");
      return result.result;
    },
  };
}

const toolResult = (result) => ({ content: [{ type: "text", text: JSON.stringify(result) }], details: result });

// A guest that resolves its VM on every call, so the VM can be released while the
// worker is idle and booted again on demand without invalidating the proxies.
export const lazyGuest = (ensure) => ({
  fs: {
    writeFile: async (...args) => (await ensure()).fs.writeFile(...args),
    readFile: async (...args) => (await ensure()).fs.readFile(...args),
  },
  exec: async (...args) => (await ensure()).exec(...args),
});

// Installs only guest-described operations approved in this worker's trusted
// runtime config. This module imports no Armory suite implementation.
export async function registerArmoryWorkerProxies(pi, { config = readWorkerArmoryConfig(), guest }) {
  const registered = new Set();
  const runners = [];
  for (const suite of config.suites) {
    const runner = createGuestSuiteRunner({ guest, rootPath: suite.rootPath, operations: suite.tools });
    runners.push(runner);
    const descriptors = await runner.describe();
    for (const descriptor of descriptors) {
      if (registered.has(descriptor.name)) throw new Error(`Duplicate Armory operation: ${descriptor.name}`);
      registered.add(descriptor.name);
      pi.registerTool({
        name: descriptor.name,
        label: descriptor.name,
        description: descriptor.description,
        parameters: descriptor.parameters,
        async execute(_id, input) {
          return toolResult(await runner.invoke(descriptor.name, input));
        },
      });
    }
  }
  // Describing is cheap and exercises the same path as a call, so running it ahead of a
  // run boots the VM and primes the suite (its first-use setup) while the model thinks.
  return { warm: () => Promise.all(runners.map((runner) => runner.describe())).then(() => undefined) };
}
