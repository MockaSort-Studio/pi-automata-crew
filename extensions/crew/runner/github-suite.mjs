import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { discardPrivateCopy } from "./armory-source.mjs";
import { workspaceFs } from "./workspace-fs.mjs";

const run = promisify(execFile);

// How the suite's `gh` runs on the host. The Crew's own token is the only credential: it is set explicitly,
// and gh's own config directory is an empty private one, so the user's stored login can never be used and
// the agent's VM never sees the token at all. Asynchronous, so a slow GitHub call never blocks other agents.
export function hostGhTransport({ token, exec = run }) {
  if (!token) throw new Error("The GitHub suite requires a Crew token (HALL_GITHUB_TOKEN)");
  const configDir = mkdtempSync(join(tmpdir(), "crew-gh-"));
  const env = {
    PATH: process.env.PATH,
    HOME: configDir,
    GH_CONFIG_DIR: configDir,
    GH_TOKEN: token,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
  };
  return {
    async run(args, options = {}) {
      const { stdout } = await exec("gh", args, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        ...options,
        env,
      });
      return stdout;
    },
  };
}

// Imports a suite bundle. A private copy made by `fetchSuiteExtension` is discarded once imported.
export async function loadSuiteModule(path) {
  try {
    return await import(pathToFileURL(path).href);
  } finally {
    discardPrivateCopy(path);
  }
}

const injection = ({ workspace, token, transport }) => ({
  commandTransport: transport,
  workspace: { fs: workspaceFs(workspace), dir: "/", env: { GITHUB_TOKEN: token } },
});

// The suite's operations as plain calls, for the runner's own use (salvage). Same code and injection as an
// agent's tools, but independent of any session. Policy is the caller's responsibility here: the runner
// only ever acts on the branch and revision it derived itself.
export function createSuiteOperations({ module, workspace, token, transport = hostGhTransport({ token }) }) {
  const registry = new Map();
  module.activateSuite(
    { registerTool: (tool) => registry.set(tool.name, tool), on() {} },
    injection({ workspace, token, transport }),
  );
  return {
    async call(name, input, { signal } = {}) {
      const tool = registry.get(name);
      if (!tool) throw new Error(`The suite has no operation ${name}`);
      const result = await tool.execute(`runner-${name}`, input, signal);
      const text = (result?.content ?? []).map((part) => part.text ?? "").join("");
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  };
}

// An extension factory that installs the GitHub suite for one agent: the suite is the Armory's generic code, and
// only the operations the member was granted are registered. `ready` resolves once the workspace is seeded.
// Nothing else is checked here: what a member may call is its granted list, and the host's credential and the
// tools themselves decide what a call can do.
export function githubSuiteExtension({
  module,
  workspace,
  token,
  operations,
  ready,
  transport = hostGhTransport({ token }),
}) {
  const granted = new Set(operations);
  return (pi) => {
    const registered = new Set();
    const scoped = new Proxy(pi, {
      get: (target, key) =>
        key === "registerTool"
          ? (tool) => {
              if (!granted.has(tool.name)) return;
              registered.add(tool.name);
              return target.registerTool(tool);
            }
          : typeof target[key] === "function"
            ? target[key].bind(target)
            : target[key],
    });
    module.activateSuite(scoped, injection({ workspace, token, transport }));
    const missing = [...granted].filter((name) => !registered.has(name));
    if (missing.length) throw new Error(`The Armory suite has no operation: ${missing.join(", ")}`);
    pi.on("tool_call", async (event) => {
      if (!granted.has(event.toolName)) return;
      try {
        await ready?.();
      } catch (error) {
        return { block: true, reason: `The workspace could not be prepared: ${error.message}` };
      }
    });
  };
}
