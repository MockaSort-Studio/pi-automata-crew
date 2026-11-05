import { strict as assert } from "node:assert";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { mockModel, providerFor } from "./mock-model.mjs";

// Drives Pi's real model -> tool-call -> `start_crew` path with an offline OpenAI-compatible mock
// provider, then kills the owning Pi process and proves nothing it started survives.
const root = new URL("../..", import.meta.url).pathname;
const piAvailable = () => spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0;
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
      model: "mock/mock-model",
      members: [
        {
          name: "snowball",
          role: "developer",
          task: "wait",
          tools: [{ suite: "system", operations: ["read"] }],
        },
      ],
      environment: { microvm: "none" },
    });
    const model = mockModel((call) =>
      call === 1 ? { toolCall: { name: "start_crew", arguments: crew } } : { text: "launched" },
    );
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "owner-death-"));
    let owner;
    let pids = [];
    try {
      cpSync(join(root, "extensions"), join(dir, "extensions"), { recursive: true });
      symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
      writeFileSync(join(dir, ".gitignore"), ".pi/runtime/\nnode_modules\n");
      writeFileSync(
        join(dir, "mock-provider.mjs"),
        `export default (pi) => pi.registerProvider("mock", ${JSON.stringify(providerFor(model))});\n`,
      );
      const agentDir = join(dir, "agent");
      const userExtension = join(agentDir, "extensions", "mock-provider", "index.ts");
      mkdirSync(dirname(userExtension), { recursive: true });
      writeFileSync(
        userExtension,
        `export { default } from ${JSON.stringify(join(root, "tests/runtime/fixtures/mock-provider-from-env.mjs"))};\n`,
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
          join(dir, "extensions/crew/crew/index.ts"),
          "-e",
          join(dir, "extensions/crew/crew-runtime/index.ts"),
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            PI_OFFLINE: "1",
            PI_CODING_AGENT_DIR: agentDir,
            HALL_TEST_MOCK_MODEL_PORT: String(model.address().port),
          },
          stdio: ["pipe", "pipe", "ignore"],
        },
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
      const evidence = readdirSync(join(dir, ".pi", "runtime"), { recursive: true })
        .filter((name) => String(name).endsWith(".json"))
        .map((name) => readFileSync(join(dir, ".pi", "runtime", String(name)), "utf8"));
      assert.ok(evidence.length, "launch and archive evidence exists");
      for (const text of evidence) assert.doesNotMatch(text, /"authToken"\s*:/);
    } finally {
      owner?.kill("SIGKILL");
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
      model.close();
      spawnSync("git", ["worktree", "prune"], { cwd: dir });
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
