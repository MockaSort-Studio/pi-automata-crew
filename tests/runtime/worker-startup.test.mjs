import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const worker = readFileSync(new URL("../../.pi/extensions/hall-crew/crew-runtime/lib/worker.mjs", import.meta.url), "utf8");

test("resident workers prompt only after their correlated session bootstrap", () => {
  assert.match(worker, /id: "worker-session", type: "new_session"/);
  assert.match(worker, /message\.id === "worker-session"[\s\S]*?if \(message\.success\) sendStartupPrompt\(\)/);
  assert.match(worker, /if \(config\.resident\) send\(\{ id: "worker-session"/);
});

test("worker.mjs is syntactically valid (a parse error silently prevents every launch)", () => {
  execFileSync(process.execPath, ["--check", new URL("../../.pi/extensions/hall-crew/crew-runtime/lib/worker.mjs", import.meta.url).pathname]);
});
