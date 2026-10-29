import { strict as assert } from "node:assert";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Drives Pi's real model -> tool-call -> `start_crew` path with an offline OpenAI-compatible mock
// provider, then kills the owning Pi process and proves nothing it started survives.
const root = new URL("../..", import.meta.url).pathname;
const piAvailable = () => spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0;
const chunk = (id, delta, finish = null) =>
  `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function mockModel(crewArguments) {
  let calls = 0;
  return http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const id = `mock-${++calls}`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (calls === 1) {
        const call = {
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "start_crew", arguments: crewArguments },
        };
        response.write(chunk(id, { role: "assistant", tool_calls: [call] }) + chunk(id, {}, "tool_calls"));
      } else response.write(chunk(id, { role: "assistant", content: "launched" }) + chunk(id, {}, "stop"));
      response.end("data: [DONE]\n\n");
    });
  });
}

const processes = () =>
  execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

test(
  "killing the Pi that ran start_crew stops Comm, Lifecycle and the worker, and keeps the evidence",
  { skip: !piAvailable() && "pi is not installed", timeout: 120_000 },
  async () => {
    const crew = JSON.stringify({
      members: [
        { name: "snowball", role: "developer", task: "wait", tools: [{ suite: "system", operations: ["read"] }] },
      ],
      environment: { microvm: "none" },
    });
    const model = mockModel(crew);
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "owner-death-"));
    let owner;
    let pids = [];
    try {
      cpSync(join(root, ".pi", "extensions"), join(dir, ".pi", "extensions"), { recursive: true });
      symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
      writeFileSync(join(dir, ".gitignore"), ".pi/runtime/\nnode_modules\n");
      const provider = {
        baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
        apiKey: "mock-key",
        api: "openai-completions",
        models: [
          {
            id: "mock-model",
            name: "Mock",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      };
      writeFileSync(
        join(dir, "mock-provider.mjs"),
        `export default (pi) => pi.registerProvider("mock", ${JSON.stringify(provider)});\n`,
      );
      const git = (...args) =>
        execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir });
      git("init", "-q");
      git("add", "-A");
      git("commit", "-q", "-m", "init");

      owner = spawn(
        "pi",
        [
          "--mode",
          "rpc",
          "--no-session",
          "--no-extensions",
          "--no-context-files",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--approve",
          "--offline",
          "--provider",
          "mock",
          "--model",
          "mock-model",
          "-e",
          join(dir, "mock-provider.mjs"),
          "-e",
          join(dir, ".pi/extensions/hall-crew/crew/index.ts"),
          "-e",
          join(dir, ".pi/extensions/hall-crew/crew-runtime/index.ts"),
        ],
        { cwd: dir, env: { ...process.env, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "ignore"] },
      );
      let launched;
      let buffer = "";
      owner.stdout.on("data", (data) => {
        buffer += String(data);
        for (let index; (index = buffer.indexOf("\n")) >= 0; ) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === "tool_execution_end" && event.toolName === "start_crew") launched = event;
          } catch {}
        }
      });
      // Pi installs its RPC reader asynchronously; retry the prompt until the model is reached.
      const prompt = setInterval(
        () => owner.stdin.write(`${JSON.stringify({ type: "prompt", message: "launch the crew" })}\n`),
        1_000,
      );
      await until(() => launched, "start_crew was never executed by the model path");
      clearInterval(prompt);
      assert.equal(launched.isError, false, JSON.stringify(launched.result));

      const children = () => processes().filter((item) => item.ppid === owner.pid);
      const servers = await until(() => {
        const found = children().filter((item) => /(comm|lifecycle)-server\.mjs/.test(item.command));
        return found.length === 2 && found;
      }, "Comm and Lifecycle servers did not start under the owner");
      const lifecycle = servers.find((item) => /lifecycle-server/.test(item.command));
      const worker = await until(
        () => processes().find((item) => item.ppid === lifecycle.pid && /lib\/worker\.mjs/.test(item.command)),
        "worker did not start",
      );
      pids = [...servers.map((item) => item.pid), worker.pid];

      owner.kill("SIGKILL");
      await until(() => pids.every((pid) => !alive(pid)), `survivors after owner death: ${pids.filter(alive)}`);
      const archive = join(dir, ".pi", "runtime", "archive");
      await until(
        () => existsSync(archive) && readdirSync(archive).some((name) => name.endsWith("developer-snowball-00")),
        "worker evidence was not archived",
      );
      assert.equal(
        existsSync(join(dir, ".pi", "runtime", "runs")) ? readdirSync(join(dir, ".pi", "runtime", "runs")).length : 0,
        0,
      );
    } finally {
      owner?.kill("SIGKILL");
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
      model.close();
      spawnSync("git", ["worktree", "prune"], { cwd: dir });
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
