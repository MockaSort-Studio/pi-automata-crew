import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mockModel, providerFor } from "./mock-model.mjs";

// A Crew report must reach a busy Main between its tool calls, not only after it stops working.
const notifier = new URL("../../extensions/crew/crew-runtime/lib/main-delivery-notifier.mjs", import.meta.url);
const piAvailable = () => spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0;

test(
  "a Crew report is delivered to a busy Main before its work finishes",
  { skip: !piAvailable() && "pi is not installed", timeout: 60_000 },
  async () => {
    const busyCalls = 4;
    const model = mockModel((call) =>
      call <= busyCalls
        ? { toolCall: { name: "bash", arguments: JSON.stringify({ command: "sleep 1" }) } }
        : { text: "done" },
    );
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "busy-main-"));
    let main;
    try {
      writeFileSync(
        join(dir, "probe.mjs"),
        `import { createMainDeliveryNotifier } from ${JSON.stringify(notifier.href)};
export default (pi) => {
  pi.registerProvider("mock", ${JSON.stringify(providerFor(model))});
  const notify = createMainDeliveryNotifier((message, options) => pi.sendMessage(message, options));
  pi.on("session_start", () => setTimeout(() => notify({ id: "m1", from: "crew-70ea0c4d-1bac-4986-b8f8-ca1bf3eaae60-developer-snowball-00", kind: "notify", payload: { status: "complete" } }), 1500));
};\n`,
      );
      main = spawn(
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
          "--offline",
          "--provider",
          "mock",
          "--model",
          "mock-model",
          "-e",
          join(dir, "probe.mjs"),
        ],
        { cwd: dir, env: { ...process.env, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "ignore"] },
      );
      let finished = false;
      main.stdout.on("data", (data) => {
        if (String(data).includes('"agent_end"')) finished = true;
      });
      const prompt = setInterval(
        () => main.stdin.write(`${JSON.stringify({ type: "prompt", message: "work" })}\n`),
        1_000,
      );
      const deadline = Date.now() + 45_000;
      while (!finished && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      clearInterval(prompt);
      assert.ok(finished, "the busy session never finished");

      const seenAt = model.requests.findIndex((body) =>
        body.includes("Crew message (notify) from developer-snowball-00"),
      );
      assert.ok(seenAt >= 0, "the report never reached the model");
      assert.ok(
        seenAt < busyCalls,
        `report reached the model only at request ${seenAt + 1}, after its ${busyCalls} busy calls`,
      );
    } finally {
      main?.kill("SIGKILL");
      model.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
