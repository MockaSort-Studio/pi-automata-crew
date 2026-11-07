import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { classifyRun } from "./classify-run.mjs";
import { resolveModel } from "./model.mjs";
import { createRequestInputTool } from "./request-input-tool.mjs";

const EVIDENCE_TOOLS = new Set(["github_git_commit", "github_git_push", "github_pull_request_create"]);

// Facts about what an agent produced come from tool results the runner saw, never from what the model says.
function recordEvidence(evidence, event) {
  if (!EVIDENCE_TOOLS.has(event.toolName) || event.isError) return;
  const text = (event.result?.content ?? []).map((part) => part.text ?? "").join("");
  try {
    const result = JSON.parse(text);
    if (event.toolName === "github_git_commit" && result.commit) evidence.commits.push(result.commit);
    if (event.toolName === "github_git_push") evidence.pushed = { branch: result.branch, commit: result.commit };
    if (event.toolName === "github_pull_request_create" && result.url) evidence.pullRequest = result.url;
  } catch {}
}

// One agent, one assignment: a Pi SDK session driven from outside. The result is what the run did, decided
// by classifyRun. Built-in tools, Armory extensions and the environment routing all arrive as extensions so
// this module knows nothing about Gondolin or GitHub.
export async function runAgent({
  name = "agent",
  cwd,
  model,
  thinking,
  instructions = "",
  task,
  tools = [],
  extensionFactories = [],
  extensionPaths = [],
  customTools = [],
  modelRuntime,
  settings,
  sessionDir,
  signal,
  onEvent = () => {},
}) {
  const runtime = modelRuntime ?? (await ModelRuntime.create());
  const resolved = model ? resolveModel(runtime, model) : undefined;
  const agentDir = getAgentDir();
  // A worker never discovers the user's extensions, skills, prompts or context files: its capabilities are
  // exactly what is passed in here.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: extensionPaths,
    extensionFactories,
    appendSystemPrompt: instructions ? [instructions] : [],
  });
  await resourceLoader.reload();

  let inputRequest;
  let cancelled = false;
  let sessionRef;
  const requestInput = createRequestInputTool({
    onRequest: (request) => {
      inputRequest ??= request;
      // Ending the run is the point of asking; abort outside this tool call so it can return first.
      setTimeout(() => sessionRef?.abort(), 0);
    },
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    ...(resolved ? { model: resolved } : {}),
    ...(thinking ? { thinkingLevel: thinking } : {}),
    modelRuntime: runtime,
    resourceLoader,
    tools: [...new Set([...tools, requestInput.name])],
    customTools: [requestInput, ...customTools],
    sessionManager: sessionDir ? SessionManager.create(cwd, sessionDir) : SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory(settings ?? {}),
  });
  sessionRef = session;

  const evidence = { commits: [], pushed: undefined, pullRequest: undefined };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_start") onEvent({ type: "tool_start", name: event.toolName });
    if (event.type === "tool_execution_end") {
      recordEvidence(evidence, event);
      onEvent({ type: "tool_end", name: event.toolName, error: Boolean(event.isError) });
    }
    if (event.type === "turn_end") onEvent({ type: "turn" });
  });
  const onAbort = () => {
    cancelled = true;
    session.abort().catch(() => undefined);
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  let thrown;
  try {
    await session.prompt(task);
  } catch (error) {
    thrown = error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
  }
  const outcome = classifyRun({ messages: session.messages, cancelled, inputRequest, thrown });
  const result = {
    member: name,
    ...outcome,
    evidence,
    model: resolved && `${resolved.provider}/${resolved.id}`,
    transcriptRef: session.sessionFile,
  };
  session.dispose();
  return result;
}
