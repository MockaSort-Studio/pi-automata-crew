import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { repositoryAuthorization } from "../env-runtime/lib/repository-authorization.mjs";
import { populateRepositoryWorkspace } from "../env-runtime/lib/repository-workspace.mjs";
import { createAgentRun } from "./agent-run.mjs";
import { verifyPullRequest } from "./ci-verify.mjs";
import { createEnvironment } from "./environment.mjs";
import { githubCiHeadersAllowed, githubCiRequestAllowed } from "./github-ci-network.mjs";
import { createSuiteOperations, githubSuiteExtension } from "./github-suite.mjs";
import { routedToolsExtension } from "./routing-extension.mjs";
import { salvage } from "./salvage.mjs";

const GITHUB_SUITE = "collaboration/pi-github-tools";
const WRITE_OPERATIONS = ["github_git_commit", "github_git_push"];
const CREATE_PULL_REQUEST = "github_pull_request_create";

// Everything one member needs, from its spec (the role's tools and grants, unchanged) and the crew's shared
// context: its own VM environment seeded from the repository revision, the routed built-in tools, the GitHub
// suite on the host if it was granted, and, only if it may write, a host-side rescue of its work.
// `crew`: { runId, dir, repository?, seedArchive?, github?: { module, token }, modelRuntime, idleMs }
export async function createMemberAgent({ member, crew, onEvent }) {
  const cwd = join(crew.dir, "agents", member.handle, "cwd");
  mkdirSync(cwd, { recursive: true });
  const policy = crew.repository
    ? repositoryAuthorization({ ...crew.repository, branch: `crew/${crew.runId}/${member.handle}` })
    : undefined;
  const granted = member.suiteGrants?.find((grant) => grant.suite === GITHUB_SUITE);
  const github = granted && crew.github;
  if (granted && !github)
    throw new Error(`${member.handle} is granted the GitHub suite but none is available to this crew`);
  if (granted && !policy)
    throw new Error(`${member.handle} is granted the GitHub suite but the crew has no repository authorization`);
  const operations = granted?.operations ?? [];
  const ciAccess =
    github?.token &&
    operations.some((name) => ["github_workflow_runs_list", "github_workflow_run_view"].includes(name));
  const environment = createEnvironment({
    localCwd: cwd,
    label: member.handle,
    idleMs: crew.idleMs,
    ...(ciAccess
      ? {
          allowedHosts: ["api.github.com"],
          secrets: { GH_TOKEN: { value: github.token, hosts: ["api.github.com"] } },
          onRequest: (request, env) =>
            githubCiHeadersAllowed(request.headers, env.GH_TOKEN) &&
            githubCiRequestAllowed(request, { repo: policy.repo, operations })
              ? undefined
              : new Response("blocked", { status: 403 }),
        }
      : {}),
    seed: crew.seedArchive ? (workspace) => populateRepositoryWorkspace(workspace, crew.seedArchive) : undefined,
  });
  const extensionFactories = [routedToolsExtension(environment)];
  if (github)
    extensionFactories.push(
      githubSuiteExtension({
        module: github.module,
        workspace: environment.workspace,
        token: github.token,
        policy,
        ready: environment.ready,
      }),
    );
  const run = await createAgentRun({
    name: member.handle,
    cwd,
    model: member.model,
    thinking: member.thinking,
    instructions: member.instructions,
    tools: [...member.tools, ...operations],
    extensionFactories,
    sessionDir: join(crew.dir, "agents", member.handle, "sessions"),
    modelRuntime: crew.modelRuntime,
    settings: crew.settings,
    onEvent: (event) => onEvent?.(member.handle, event),
  }).catch(async (error) => {
    await environment.close();
    throw error;
  });
  const canWrite = github && WRITE_OPERATIONS.every((name) => operations.includes(name));
  const suite =
    canWrite && createSuiteOperations({ module: github.module, workspace: environment.workspace, token: github.token });
  return {
    run,
    environment,
    policy,
    salvage: suite
      ? (status) =>
          environment.ready().then(() => salvage({ ops: suite, policy, member: member.handle, reason: status }))
      : undefined,
    // A member that can open pull requests is held to a green CI on the one it opened (see ci-verify.mjs).
    verify:
      suite && operations.includes(CREATE_PULL_REQUEST)
        ? ({ result, signal }) => verifyPullRequest({ ops: suite, policy, evidence: result.evidence, signal })
        : undefined,
    async dispose() {
      run.dispose();
      await environment.close();
    },
  };
}
