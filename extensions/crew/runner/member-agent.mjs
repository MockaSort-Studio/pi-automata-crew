import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { repositoryContext } from "../env-runtime/lib/repository-context.mjs";
import { populateRepositoryWorkspace } from "../env-runtime/lib/repository-workspace.mjs";
import { createAgentRun } from "./agent-run.mjs";
import { verifyPullRequest } from "./ci-verify.mjs";
import { createEnvironment } from "./environment.mjs";
import { prepareDependencyMount } from "./dependency-mount.mjs";
import { verificationFacts } from "./verification-facts.mjs";
import { createSuiteOperations, githubSuiteExtension } from "./github-suite.mjs";
import { routedToolsExtension } from "./routing-extension.mjs";
import { salvage } from "./salvage.mjs";

const GITHUB_SUITE = "collaboration/pi-github-tools";
// The runner acts for a member only with operations the member was granted: salvage needs all of the first
// set, and holding a pull request to green CI needs the second.
const SALVAGE_OPERATIONS = [
  "github_git_status",
  "github_workspace_checkout",
  "github_git_stage",
  "github_git_commit",
  "github_git_push",
];
const VERIFY_OPERATIONS = ["github_pull_request_create", "github_pull_request_view", "github_pull_request_files"];

// The VM is closed even when the session's disposal throws, so a failed disposal never leaks the VM.
export async function disposeMember(run, environment) {
  try {
    await run.dispose();
  } finally {
    await environment.close();
  }
}

// Everything one member needs, from its spec (the role's tools and grants, unchanged) and the crew's shared
// context: its own VM environment seeded from the repository revision, the routed built-in tools, the GitHub
// suite on the host if it was granted, and, only if it may write, a host-side rescue of its work.
// `crew`: { runId, dir, repository?, seedArchive?, github?: { module, token }, modelRuntime, idleMs }
export async function createMemberAgent({ member, crew, onEvent, prepareSources = prepareDependencyMount }) {
  const cwd = join(crew.dir, "agents", member.handle, "cwd");
  mkdirSync(cwd, { recursive: true });
  const repository = crew.repository
    ? repositoryContext({ ...crew.repository, branch: `crew/${crew.runId}/${member.handle}` })
    : undefined;
  const granted = member.suiteGrants?.find((grant) => grant.suite === GITHUB_SUITE);
  const github = granted && crew.github;
  if (granted && !github)
    throw new Error(`${member.handle} is granted the GitHub suite but none is available to this crew`);
  if (granted && !repository)
    throw new Error(`${member.handle} is granted the GitHub suite but the crew has no repository context`);
  const operations = granted?.operations ?? [];
  const hasBash = member.tools.includes("bash");
  let sources;
  if (hasBash) {
    try {
      sources = await prepareSources();
    } catch {
      sources = { available: [], failures: ["Verified dependency source mount unavailable"] };
    }
  }
  const environment = createEnvironment({
    dependencySources: sources?.provider,
    localCwd: cwd,
    label: member.handle,
    idleMs: crew.idleMs,
    seed: crew.seedArchive ? (workspace) => populateRepositoryWorkspace(workspace, crew.seedArchive) : undefined,
  });
  const extensionFactories = [routedToolsExtension(environment)];
  if (github)
    extensionFactories.push(
      githubSuiteExtension({
        module: github.module,
        workspace: environment.workspace,
        token: github.token,
        operations,
        ready: environment.ready,
      }),
    );
  const run = await createAgentRun({
    name: member.handle,
    cwd,
    model: member.model,
    thinking: member.thinking,
    instructions: `${member.instructions ?? ""}\n\n${verificationFacts(sources, hasBash)}`,
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
  const holds = (needed) => needed.every((name) => operations.includes(name));
  const suite =
    github &&
    (holds(SALVAGE_OPERATIONS) || holds(VERIFY_OPERATIONS)) &&
    createSuiteOperations({ module: github.module, workspace: environment.workspace, token: github.token, operations });
  return {
    run,
    environment,
    repository,
    salvage:
      suite && holds(SALVAGE_OPERATIONS)
        ? (status) =>
            environment.ready().then(() => salvage({ ops: suite, repository, member: member.handle, reason: status }))
        : undefined,
    // A member that can open pull requests is held to a green CI on the one it opened (see ci-verify.mjs).
    verify:
      suite && holds(VERIFY_OPERATIONS)
        ? ({ result, signal }) => verifyPullRequest({ ops: suite, repository, evidence: result.evidence, signal })
        : undefined,
    dispose: () => disposeMember(run, environment),
  };
}
