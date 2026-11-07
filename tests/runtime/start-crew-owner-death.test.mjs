import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
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
import { listProcesses, vmmChildrenOf } from "../../extensions/crew/env-runtime/lib/vm-processes.mjs";
import { mockModel, providerFor } from "./mock-model.mjs";

// Drives Pi's real model -> tool-call -> `start_crew` path with an offline OpenAI-compatible mock provider.
// The member then runs a command in its own VM, and the owning Pi is killed outright: nothing it started may
// survive, and no credential may reach any file. Pi, the extension, the host process and the VM are all real.
const root = new URL("../..", import.meta.url).pathname;
const piAvailable = () => spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
const CANARY = "canary-token-8c1f5d";

test(
  "killing the Pi that ran start_crew closes the crew host and every VM, and no credential reaches a file",
  // Crew members run only in Gondolin, so this launches a real VM.
  {
    skip:
      (!piAvailable() && "pi is not installed") ||
      (process.env.HALL_SKIP_GONDOLIN_LIVE_TESTS === "1" && "live Gondolin VM tests are disabled on this runner"),
    timeout: 180_000,
  },
  async () => {
    const crew = JSON.stringify({
      model: "mock/mock-model",
      members: [
        {
          name: "snowball",
          role: "developer",
          task: "wait",
          tools: [{ suite: "system", operations: ["read", "bash"] }],
        },
      ],
      environment: { microvm: "gondolin" },
    });
    let mainCalls = 0;
    const model = mockModel((_call, body) => {
      // Main's requests offer start_crew; the member's (served to the host process) do not.
      if (body.includes('"name":"start_crew"'))
        return (mainCalls += 1) === 1 ? { toolCall: { name: "start_crew", arguments: crew } } : { text: "launched" };
      return { toolCall: { name: "bash", arguments: JSON.stringify({ command: "echo started; sleep 300" }) } };
    });
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "owner-death-"));
    let owner;
    let hostPid;
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
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            PI_OFFLINE: "1",
            PI_CODING_AGENT_DIR: agentDir,
            HALL_TEST_MOCK_MODEL_PORT: String(model.address().port),
            // The crew host process reaches the same offline model, and must never write this to a file.
            HALL_GITHUB_TOKEN: CANARY,
            CREW_HOST_DEPS: join(root, "tests/runtime/fixtures/host-deps.mjs"),
            CREW_TEST_MOCK_URL: `http://127.0.0.1:${model.address().port}/v1`,
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

      const host = await until(
        () => listProcesses().find((item) => item.ppid === owner.pid && /host-main\.mjs/.test(item.command)),
        "the crew host did not start under Pi",
      );
      hostPid = host.pid;
      const vms = await until(() => {
        const found = vmmChildrenOf(hostPid, listProcesses());
        return found.length === 1 && found;
      }, "the member's VM did not start");

      owner.kill("SIGKILL");
      await until(() => !alive(hostPid), "the crew host survived the death of Pi");
      await until(
        () => !listProcesses().some((item) => vms.some((vm) => vm.pid === item.pid && vm.start === item.start)),
        "a VM survived the death of Pi",
        30_000,
      );

      const files = readdirSync(join(dir, ".pi", "runtime"), { recursive: true, withFileTypes: true }).filter((entry) =>
        entry.isFile(),
      );
      assert.ok(files.length > 0);
      assert.ok(existsSync(join(dir, ".pi", "runtime", "crew-host.log")), "the host's diagnostics are kept");
      for (const file of files)
        assert.doesNotMatch(
          readFileSync(join(file.parentPath ?? file.path, file.name), "utf8"),
          new RegExp(CANARY),
          file.name,
        );
    } finally {
      owner?.kill("SIGKILL");
      if (hostPid && alive(hostPid)) process.kill(hostPid, "SIGKILL");
      model.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
