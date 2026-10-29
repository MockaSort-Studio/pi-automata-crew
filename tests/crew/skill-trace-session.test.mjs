import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mockModel, providerFor } from "../runtime/mock-model.mjs";

// Real Pi, offline mock model: using a skill must leave a visible entry in the session, and that entry
// must never be sent to the model.
const root = new URL("../..", import.meta.url).pathname;
const piAvailable = () => spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0;

test(
  "using a skill leaves a transcript entry that is not sent to the model",
  { skip: !piAvailable() && "pi is not installed", timeout: 90_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-trace-"));
    const skillFile = join(dir, "skills", "demo", "SKILL.md");
    const model = mockModel((call) =>
      call === 1 ? { toolCall: { name: "read", arguments: JSON.stringify({ path: skillFile }) } } : { text: "done" },
    );
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    let pi;
    try {
      cpSync(join(root, ".pi", "extensions"), join(dir, ".pi", "extensions"), { recursive: true });
      symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
      mkdirSync(join(dir, "skills", "demo"), { recursive: true });
      writeFileSync(skillFile, "---\nname: demo\ndescription: Demo skill used only by this test.\n---\nDo the demo.\n");
      writeFileSync(
        join(dir, "mock-provider.mjs"),
        `export default (pi) => pi.registerProvider("mock", ${JSON.stringify(providerFor(model))});\n`,
      );
      pi = spawn(
        "pi",
        [
          "--mode",
          "rpc",
          "--session-dir",
          join(dir, "sessions"),
          "--no-extensions",
          "--no-context-files",
          "--no-prompt-templates",
          "--no-themes",
          "--no-skills",
          "--skill",
          join(dir, "skills", "demo"),
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
        ],
        { cwd: dir, env: { ...process.env, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "ignore"] },
      );
      let finished = false;
      pi.stdout.on("data", (data) => {
        if (String(data).includes('"agent_end"')) finished = true;
      });
      const prompt = setInterval(
        () => pi.stdin.write(`${JSON.stringify({ type: "prompt", message: "/skill:demo go" })}\n`),
        1_000,
      );
      const deadline = Date.now() + 60_000;
      while (!finished && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      clearInterval(prompt);
      assert.ok(finished, "the session never finished");

      const sessions = join(dir, "sessions");
      const lines = readdirSync(sessions, { recursive: true })
        .filter((name) => String(name).endsWith(".jsonl"))
        .flatMap((name) =>
          readFileSync(join(sessions, String(name)), "utf8")
            .split("\n")
            .filter(Boolean),
        )
        .map((line) => JSON.parse(line));
      const used = lines.filter((entry) => entry.customType === "skill-used").map((entry) => entry.data);
      assert.deepEqual(used.map((item) => `${item.skill}:${item.via}`).sort(), ["demo:command", "demo:read"]);
      assert.ok(
        model.requests.every((body) => !body.includes("skill-used")),
        "the trace entry reached the model",
      );
    } finally {
      pi?.kill("SIGKILL");
      model.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
