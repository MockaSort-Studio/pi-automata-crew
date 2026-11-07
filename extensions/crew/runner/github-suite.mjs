import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  authorizeRepositoryOperation,
  ownPullRequestOperations,
} from "../env-runtime/lib/repository-authorization.mjs";
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
    const ownedPullRequests = new Set();
    module.activateSuite(pi, injection({ workspace, token, transport }));
    pi.on("tool_call", async (event) => {
      try {
        if (
          event.toolName.startsWith("github_") &&
          typeof event.input?.repo === "string" &&
          (!policy || event.input.repo.toLowerCase() !== policy.repo.toLowerCase())
        )
          throw new Error("Repository operation is outside the worker authorization");
        authorizeRepositoryOperation(event.toolName, event.input, policy);
      } catch (error) {
        return { block: true, reason: error.message };
      }
      if (ownPullRequestOperations.has(event.toolName) && !ownedPullRequests.has(event.input.pullNumber)) {
        try {
          const pr = JSON.parse(
            await transport.run([
              "pr",
              "view",
              String(event.input.pullNumber),
              "--repo",
              policy.repo,
              "--json",
              "headRefName,baseRefName,isCrossRepository",
            ]),
          );
          if (pr.headRefName !== policy.branch || pr.baseRefName !== policy.base || pr.isCrossRepository !== false)
            throw new Error("not owned");
          ownedPullRequests.add(event.input.pullNumber);
        } catch {
          return { block: true, reason: "A worker can only change its own pull request" };
        }
      }
      if (event.toolName === "github_pull_request_create") event.input.draft = true;
      try {
        await ready?.();
      } catch (error) {
        return { block: true, reason: `The workspace could not be prepared: ${error.message}` };
      }
    });
    pi.on("tool_result", (event) => {
      if (event.toolName === "github_pull_request_create" && !event.isError)
        return {
          content: [...event.content, { type: "text", text: "Crew policy created this pull request as a draft." }],
        };
    });
  };
}
