import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RESOLVED_MODEL_MARKER } from "../../.pi/extensions/hall-crew/crew-runtime/lib/worker-events.mjs";

// Split out of worker-comm-extension.test.mjs to keep that file at its
// original size: same loadExtension helper, but scoped to the one behavior
// under test here (relaying the RPC session's actually-resolved model id).
const loadExtension = async (config) => {
  const dir = mkdtempSync(join(tmpdir(), "worker-comm-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(config));
  process.env.PI_CREW_WORKER_CONFIG = configPath;
  const module = await import(
    `../../.pi/extensions/hall-crew/crew-runtime/lib/worker-comm-extension.mjs?t=${Date.now()}-${Math.random()}`
  );
  return module.default;
};

const makeFakePi = () => {
  const pi = {
    handlers: new Map(),
    on: (event, handler) => pi.handlers.set(event, handler),
    registerTool: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
  };
  return pi;
};

test("agent_start relays the RPC session's actually-resolved model id", async () => {
  const extension = await loadExtension({ initialTurn: "resident", task: "" });
  const notified = [];
  const pi = makeFakePi();
  extension(pi);
  const ctx = {
    getSystemPrompt: () => "",
    model: { provider: "anthropic", id: "claude-sonnet-4-6", contextWindow: 200_000 },
    ui: { notify: (message) => notified.push(message) },
  };
  pi.handlers.get("agent_start")({}, ctx);
  const resolved = notified.find((message) => message.startsWith(RESOLVED_MODEL_MARKER));
  assert.ok(resolved, "expected a resolved-model marker notification");
  assert.deepEqual(JSON.parse(resolved.slice(RESOLVED_MODEL_MARKER.length)), {
    modelId: "anthropic/claude-sonnet-4-6",
    modelWindow: 200_000,
  });
});

test("agent_start skips the resolved-model marker when ctx has no active model", async () => {
  const extension = await loadExtension({ initialTurn: "resident", task: "" });
  const notified = [];
  const pi = makeFakePi();
  extension(pi);
  const ctx = { getSystemPrompt: () => "", ui: { notify: (message) => notified.push(message) } };
  pi.handlers.get("agent_start")({}, ctx);
  assert.equal(
    notified.some((message) => message.startsWith(RESOLVED_MODEL_MARKER)),
    false,
  );
});
