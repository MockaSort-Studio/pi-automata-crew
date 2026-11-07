import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { runAgent } from "../../extensions/crew/runner/agent-run.mjs";
import { createEnvironment } from "../../extensions/crew/runner/environment.mjs";
import { routedToolsExtension } from "../../extensions/crew/runner/routing-extension.mjs";
import { mockModel, providerFor } from "./mock-model.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

const call = (name, args = {}) => ({ toolCall: { name, arguments: JSON.stringify(args) } });
const TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];

async function agent(t, respond, environmentOptions = {}) {
  const server = mockModel(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "agent-live-"));
  const localCwd = join(dir, "cwd");
  (await import("node:fs")).mkdirSync(localCwd);
  const environment = createEnvironment({ localCwd, label: "test", idleMs: 0, ...environmentOptions });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  });
  modelRuntime.registerProvider("mock", providerFor(server));
  t.after(async () => {
    await environment.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const run = (extra = {}) =>
    runAgent({
      name: "dev",
      cwd: localCwd,
      model: "mock/mock-model",
      task: "go",
      tools: TOOLS,
      extensionFactories: [routedToolsExtension(environment)],
      settings: { retry: { enabled: false } },
      modelRuntime,
      ...extra,
    });
  return { server, environment, localCwd, run };
}
const toolResults = (server) =>
  server.requests.flatMap((body) =>
    JSON.parse(body)
      .messages.filter((m) => m.role === "tool")
      .map((m) => String(m.content)),
  );

test("an agent's built-in tools act in its VM and workspace, never on the host", { timeout: 180_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const script = [
    call("bash", { command: "uname -s; echo from-guest > /workspace/proof.txt" }),
    call("write", { path: "notes.txt", content: "line one\nline two\n" }),
    call("edit", { path: "notes.txt", edits: [{ oldText: "line two", newText: "line 2" }] }),
    call("read", { path: "notes.txt" }),
    call("grep", { pattern: "from-guest", path: "." }),
    { text: "all done" },
  ];
  const { run, server, environment, localCwd } = await agent(t, (n) => script[n - 1]);
  const result = await run();
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.usage.toolErrors, 0);
  const seen = toolResults(server).join("\n");
  assert.match(seen, /Linux/, "bash ran in the Linux guest");
  assert.match(seen, /line 2/, "edit and read agree");
  assert.match(seen, /from-guest/, "grep found the guest-written file");
  assert.equal((await environment.workspace.readFile("/proof.txt")).toString(), "from-guest\n");
  assert.equal((await environment.workspace.readFile("/notes.txt")).toString(), "line one\nline 2\n");
  assert.deepEqual(readdirSync(localCwd), [], "nothing was written to the host");
});

test(
  "cancelling a run kills the command in the guest and leaves the workspace usable",
  { timeout: 180_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const { run, environment } = await agent(t, () => call("bash", { command: "echo started; sleep 120" }));
    const controller = new AbortController();
    const running = run({ signal: controller.signal });
    for (let i = 0; i < 200; i += 1) {
      const live = await environment
        .withVm((vm) => vm.exec("ps | grep -c '[s]leep 120'"))
        .then(
          (r) => r.stdout.trim(),
          () => "0",
        );
      if (live !== "0") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    controller.abort();
    assert.equal((await running).status, "cancelled");
    const after = await environment.withVm((vm) =>
      vm.exec("ps | grep -c '[s]leep 120'; echo ok > /workspace/after && cat /workspace/after"),
    );
    assert.match(after.stdout, /^0\nok\n$/, "no guest process survives the cancel, and the workspace still works");
  },
);

test(
  "the VM is released when idle, the workspace survives it, and the next call boots again",
  { timeout: 180_000 },
  async (t) => {
    if (skipLiveGondolin(t)) return;
    const { run, environment } = await agent(
      t,
      (n) => (n === 1 ? call("bash", { command: "echo kept > /workspace/k" }) : { text: "ok" }),
      { idleMs: 400 },
    );
    await run();
    for (let i = 0; i < 60 && environment.isRunning(); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(environment.isRunning(), false, "the idle VM was released");
    assert.equal((await environment.workspace.readFile("/k")).toString(), "kept\n");
    assert.equal((await environment.withVm((vm) => vm.exec("cat /workspace/k"))).stdout, "kept\n");
  },
);

test("the guest network is deny-by-default", { timeout: 180_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const { run, server } = await agent(t, (n) =>
    n === 1
      ? call("bash", {
          command: "curl -sS -m 8 -o /dev/null -w '%{http_code}' https://api.github.com/ ; echo \" exit=$?\"",
        })
      : { text: "ok" },
  );
  await run();
  assert.doesNotMatch(toolResults(server).join("\n"), /\b200\b/, "the guest must not reach GitHub");
});

test("two agents in one process get separate VMs and workspaces", { timeout: 240_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const make = async (word) =>
    agent(t, (n) => (n === 1 ? call("bash", { command: `echo ${word} > /workspace/who` }) : { text: word }));
  const [a, b] = [await make("alpha"), await make("beta")];
  const [ra, rb] = await Promise.all([a.run(), b.run()]);
  assert.deepEqual([ra.status, rb.status], ["completed", "completed"]);
  assert.equal((await a.environment.workspace.readFile("/who")).toString(), "alpha\n");
  assert.equal((await b.environment.workspace.readFile("/who")).toString(), "beta\n");
});
