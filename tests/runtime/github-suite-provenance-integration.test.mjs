import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { githubSuiteExtension } from "../../extensions/crew/runner/github-suite.mjs";
import { mockModel, providerFor } from "./mock-model.mjs";
import { runAgent } from "./run-agent.mjs";

const start = "github_pull_request_review_start";
const submit = "github_pull_request_review_submit";
const policy = { repo: "owner/repo", branch: "crew/worker", base: "main" };
const call = (name, input) => ({ toolCall: { name, arguments: JSON.stringify(input) } });

test("Pi dispatch blocks later-hook starts and failed starts from review provenance", async (t) => {
  const executed = [];
  const results = [];
  const module = {
    activateSuite(pi) {
      pi.registerTool({
        name: start,
        label: start,
        description: start,
        parameters: Type.Object({ repo: Type.String(), pullNumber: Type.Number() }),
        execute: async (_id, input) => {
          executed.push([start, input.pullNumber]);
          if (input.pullNumber === 9) throw new Error("start failed");
          return { content: [{ type: "text", text: "ok" }], details: { ...input, reviewId: "own" } };
        },
      });
      pi.registerTool({
        name: submit,
        label: submit,
        description: submit,
        parameters: Type.Object({ reviewId: Type.String(), event: Type.String(), hasBlockingFindings: Type.Boolean() }),
        execute: async (_id, input) => {
          executed.push([submit, input.reviewId]);
          return { content: [{ type: "text", text: "ok" }], details: {} };
        },
      });
    },
  };
  const calls = [
    [start, { repo: policy.repo, pullNumber: 7 }],
    [start, { repo: policy.repo, pullNumber: 8 }],
    [start, { repo: policy.repo, pullNumber: 9 }],
    ...["blocked", "failed", "own"].map((reviewId) => [
      submit,
      { reviewId, event: "COMMENT", hasBlockingFindings: false },
    ]),
  ];
  const server = mockModel((n) => (n <= calls.length ? call(...calls[n - 1]) : { text: "done" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "provenance-integration-"));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  });
  modelRuntime.registerProvider("mock", providerFor(server));
  const result = await runAgent({
    cwd: dir,
    model: "mock/mock-model",
    task: "review",
    tools: [start, submit],
    settings: { retry: { enabled: false } },
    modelRuntime,
    extensionFactories: [
      githubSuiteExtension({ module, workspace: {}, token: "test", policy, transport: { run: async () => "" } }),
      (pi) => {
        pi.on("tool_call", (event) => {
          if (event.toolName === start && event.input.pullNumber === 8) return { block: true, reason: "other hook" };
        });
        pi.on("tool_result", (event) => {
          if (event.toolName === start) results.push({ pullNumber: event.input.pullNumber, isError: event.isError });
        });
      },
    ],
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(executed, [
    [start, 7],
    [start, 9],
    [submit, "own"],
  ]);
  assert.deepEqual(results, [
    { pullNumber: 7, isError: false },
    { pullNumber: 8, isError: true },
    { pullNumber: 9, isError: true },
  ]);
});
