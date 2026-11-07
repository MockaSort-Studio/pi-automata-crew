import { strict as assert } from "node:assert";
import test from "node:test";
import { routedToolsExtension } from "../../extensions/crew/runner/routing-extension.mjs";

test("routing rejects before accessing the VM and reports the reason", async () => {
  const tools = new Map();
  const calls = [];
  const vm = { exec(argv) { calls.push(argv); return { async *output() {}, then(resolve) { resolve({ exitCode: 0 }); } }; } };
  const environment = { localCwd: process.cwd(), withVm: (fn) => fn(vm) }; 
  routedToolsExtension(environment)({ on() {}, registerTool(tool) { tools.set(tool.name, tool); } });
  const bash = tools.get("bash");
  const result = await bash.execute("id", { command: "sleep 280; tail log" });
  assert.equal(calls.length, 0);
  assert.match(JSON.stringify(result), /sleep/i);
  assert.match(JSON.stringify(result), /request_input/);
  await bash.execute("id", { command: 'echo "sleep"' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].at(-1), 'echo "sleep"');
});
