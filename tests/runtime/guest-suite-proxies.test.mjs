import assert from "node:assert/strict";
import test from "node:test";
import { lazyGuest, registerArmoryWorkerProxies } from "../../.pi/extensions/hall-crew/env-runtime/lib/guest-suite.mjs";

const rootPath = "/nix/store/0123456789abcdefghijklmnopqrstuv-github";

function guest() {
  const files = new Map();
  return {
    fs: {
      async writeFile(path, value) { files.set(path, value); },
      async readFile() {
        const request = JSON.parse([...files.values()].at(-1));
        return JSON.stringify(request.operation ? { result: { issue: 1 } } : {
          operations: [{ name: "github_issue_view", description: "View an issue", parameters: { type: "object" } }],
        });
      },
    },
    async exec() { return { exitCode: 0 }; },
  };
}

test("worker proxy registers only guest-described approved operations", async () => {
  const tools = [];
  await registerArmoryWorkerProxies(
    { registerTool: (tool) => tools.push(tool) },
    { config: { suites: [{ rootPath, tools: ["github_issue_view"] }] }, guest: guest() },
  );
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "github_issue_view");
  assert.deepEqual(await tools[0].execute("id", { number: 1 }), {
    content: [{ type: "text", text: JSON.stringify({ issue: 1 }) }], details: { issue: 1 },
  });
});

test("a lazy guest resolves its VM on every call, so a released VM can be replaced under live proxies", async () => {
  const tools = [];
  let boots = 0;
  let current;
  const ensure = async () => (current ??= (boots += 1, guest()));
  await registerArmoryWorkerProxies(
    { registerTool: (tool) => tools.push(tool) },
    { config: { suites: [{ rootPath, tools: ["github_issue_view"] }] }, guest: lazyGuest(ensure) },
  );
  assert.equal(boots, 1);
  current = undefined; // the idle release
  assert.deepEqual((await tools[0].execute("id", { number: 1 })).details, { issue: 1 });
  assert.equal(boots, 2, "the next call booted a fresh VM; the proxies were never re-registered");
});
