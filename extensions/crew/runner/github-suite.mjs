import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { authorizeRepositoryOperation } from "../env-runtime/lib/repository-authorization.mjs";
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
      const { stdout } = await exec("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options, env });
      return stdout;
    },
  };
}

export const loadSuiteModule = (path) => import(pathToFileURL(path).href);

// An extension factory that installs the GitHub suite for one agent. The suite is the Armory's generic
// code; everything specific to this agent is injected: where Git acts (the environment's workspace), how gh
// runs (the Crew token), and, here, the repository policy, enforced before any guarded call executes.
// `ready` resolves once the workspace is seeded: these tools never touch the VM, which is what seeds it.
export function githubSuiteExtension({
  module,
  workspace,
  token,
  policy,
  ready,
  transport = hostGhTransport({ token }),
}) {
  return (pi) => {
    module.activateSuite(pi, {
      commandTransport: transport,
      workspace: { fs: workspaceFs(workspace), dir: "/", env: { GITHUB_TOKEN: token } },
    });
    pi.on("tool_call", async (event) => {
      try {
        authorizeRepositoryOperation(event.toolName, event.input, policy);
      } catch (error) {
        return { block: true, reason: error.message };
      }
      try {
        await ready?.();
      } catch (error) {
        return { block: true, reason: `The workspace could not be prepared: ${error.message}` };
      }
    });
  };
}
