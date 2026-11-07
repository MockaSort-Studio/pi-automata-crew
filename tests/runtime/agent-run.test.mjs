import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createAgentRun, runAgent } from "../../extensions/crew/runner/agent-run.mjs";
import { mockModel, providerFor } from "./mock-model.mjs";

const call = (name, args = {}) => ({ toolCall: { name, arguments: JSON.stringify(args) } });
const noRetry = { retry: { enabled: false } };

async function scenario(t, respond, options = {}) {
  const server = mockModel(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "agent-run-"));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  });
  modelRuntime.registerProvider("mock", providerFor(server));
  const run = (extra = {}) =>
    runAgent({
      name: "dev",
      cwd: dir,
      model: "mock/mock-model",
      task: "go",
      settings: noRetry,
      modelRuntime,
      ...options,
      ...extra,
    });
  return { server, dir, run };
}
const slowTool = () => {
  let started;
  const began = new Promise((resolve) => (started = resolve));
  return {
    began,
    tool: {
      name: "slow",
      label: "slow",
      description: "waits",
      parameters: Type.Object({}),
      execute: (_id, _input, signal) => {
        started();
        return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      },
    },
  };
};

test("a run that ends with a final message is completed", async (t) => {
  const { run, server } = await scenario(t, (n) =>
    n === 1 ? call("bash", { command: "echo hi" }) : { text: "finished" },
  );
  const result = await run({ tools: ["bash"] });
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "finished");
  assert.equal(result.usage.toolCalls, 1);
  assert.equal(server.requests.length, 2);
  assert.equal(result.model, "mock/mock-model");
});

test("the agent sees exactly the granted tools: no user extension, skill or built-in leaks in", async (t) => {
  const { run, server } = await scenario(t, () => ({ text: "ok" }));
  await run({ tools: ["read"] });
  const offered = JSON.parse(server.requests[0])
    .tools.map((tool) => tool.function.name)
    .sort();
  assert.deepEqual(offered, ["read", "request_input"]);
});

test("request_input ends the run with a question, without another model call", async (t) => {
  const { run, server } = await scenario(t, () =>
    call("request_input", { question: "Which file should I summarize?" }),
  );
  const result = await run();
  assert.equal(result.status, "needs_input");
  assert.equal(result.question, "Which file should I summarize?");
  assert.equal(server.requests.length, 1, "the run must not continue after asking");
});

test("a provider failure fails the run with a category and no provider text", async (t) => {
  const { run } = await scenario(t, () => ({
    status: 429,
    body: JSON.stringify({ error: { message: "slow down sk-abc" } }),
  }));
  const result = await run();
  assert.equal(result.status, "failed");
  assert.deepEqual(result.failure, { category: "rate_limit_or_quota", httpStatus: 429 });
  assert.doesNotMatch(JSON.stringify(result), /sk-abc/);
});

test("an empty turn fails the run instead of reporting success", async (t) => {
  const { run } = await scenario(t, () => ({ empty: true }));
  const result = await run();
  assert.equal(result.status, "failed");
  assert.equal(result.failure.category, "empty_turn");
});

test("an external abort mid-tool cancels the run", async (t) => {
  const { tool, began } = slowTool();
  const { run } = await scenario(t, () => call("slow"));
  const controller = new AbortController();
  const running = run({ customTools: [tool], tools: ["slow"], signal: controller.signal });
  await began;
  controller.abort();
  const result = await running;
  assert.equal(result.status, "cancelled");
});

test("an unknown or sentinel model fails before any model call", async (t) => {
  const { run, server } = await scenario(t, () => ({ text: "never" }));
  await assert.rejects(run({ model: "mock/nope" }), /not found/);
  await assert.rejects(run({ model: "inherit" }), /not model IDs/);
  assert.equal(server.requests.length, 0);
});

test("evidence comes from tool results the runner saw, not from the model's words", async (t) => {
  const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: {} });
  const fake = (name, value) => ({
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => json(value),
  });
  const script = ["github_git_commit", "github_git_push", "github_pull_request_create"];
  const { run } = await scenario(t, (n) =>
    n <= 3 ? call(script[n - 1]) : { text: "I opened PR https://example.test/fake/1" },
  );
  const result = await run({
    tools: script,
    customTools: [
      fake("github_git_commit", { commit: "abc123" }),
      fake("github_git_push", { branch: "crew/x", commit: "abc123" }),
      fake("github_pull_request_create", { url: "https://github.test/pull/7" }),
    ],
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.evidence, {
    commits: ["abc123"],
    pushed: { branch: "crew/x", commit: "abc123" },
    pullRequest: "https://github.test/pull/7",
  });
});

test("the transcript is persisted when a session directory is given", async (t) => {
  const { run, dir } = await scenario(t, () => ({ text: "recorded" }));
  const result = await run({ sessionDir: join(dir, "sessions") });
  assert.ok(result.transcriptRef && existsSync(result.transcriptRef));
  assert.match(readFileSync(result.transcriptRef, "utf8"), /recorded/);
});

test("after request_input the same session continues with the answer, and each turn is classified on its own", async (t) => {
  const { server, dir } = await scenario(t, (n) =>
    n === 1 ? call("request_input", { question: "Which file?" }) : { text: "summarized x.txt" },
  );
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  });
  modelRuntime.registerProvider("mock", providerFor(server));
  const run = await createAgentRun({
    name: "dev",
    cwd: dir,
    model: "mock/mock-model",
    settings: noRetry,
    modelRuntime,
  });
  const first = await run.prompt("summarize a file");
  assert.equal(first.status, "needs_input");
  assert.equal(run.busy, false);
  const second = await run.prompt("x.txt");
  assert.equal(second.status, "completed");
  assert.equal(second.finalText, "summarized x.txt");
  const lastRequest = JSON.parse(server.requests.at(-1));
  const roles = lastRequest.messages.map((m) => m.role).join(",");
  assert.match(
    roles,
    /user,assistant,tool,user$/,
    "the history, the recorded question and the answer are all in the conversation",
  );
  const answer = lastRequest.messages.at(-1).content;
  assert.equal(typeof answer === "string" ? answer : answer.map((part) => part.text).join(""), "x.txt");
  await assert.rejects(Promise.all([run.prompt("a"), run.prompt("b")]), /already working/);
  run.dispose();
});
