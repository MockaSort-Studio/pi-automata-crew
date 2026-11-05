import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Runtime } from "../../extensions/crew/crew-runtime/lib/runtime.mjs";
import { mockModel, providerFor } from "./mock-model.mjs";

// The AGENTS.md of a repo tells Main how to run a Crew. A worker that read it could try to launch
// Crews of its own, so a real worker's model must never receive it, nor the orchestration skills.
const piAvailable = () => spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0;

test(
  "a real worker's model request carries neither AGENTS.md nor the project's skills",
  { skip: !piAvailable() && "pi is not installed", timeout: 90_000 },
  async () => {
    const model = mockModel(() => ({ text: "done" }));
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "worker-context-"));
    const runtime = new Runtime(dir);
    try {
      mkdirSync(join(dir, "skills", "marker-skill"), { recursive: true });
      mkdirSync(join(dir, "extensions"), { recursive: true });
      writeFileSync(join(dir, "AGENTS.md"), "# Marker\nAGENTS-MD-MARKER-7c1e: launch a Crew with start_crew.\n");
      writeFileSync(
        join(dir, "skills", "marker-skill", "SKILL.md"),
        "---\nname: marker-skill\ndescription: SKILL-MARKER-7c1e orchestration skill that launches a Crew.\n---\nbody\n",
      );
      writeFileSync(
        join(dir, "mock-provider.mjs"),
        `export default (pi) => pi.registerProvider("mock", ${JSON.stringify(providerFor(model))});\n`,
      );
      writeFileSync(join(dir, ".gitignore"), ".pi/runtime/\n");
      const git = (...args) =>
        execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir });
      git("init", "-q");
      git("add", "-A");
      git("commit", "-q", "-m", "init");

      await runtime.spawn({
        name: "probe",
        actorId: "context-probe",
        task: "Say done.",
        model: "mock/mock-model",
        tools: ["read"],
        extensionPaths: [join(dir, "mock-provider.mjs")],
      });
      const deadline = Date.now() + 60_000;
      while (!model.requests.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(model.requests.length, "the worker never reached the model");
      const sent = model.requests[0];
      assert.doesNotMatch(sent, /AGENTS-MD-MARKER-7c1e/, "the worker received AGENTS.md");
      assert.doesNotMatch(sent, /SKILL-MARKER-7c1e/, "the worker received the project's skills");
    } finally {
      await runtime.stop();
      model.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
