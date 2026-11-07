import { strict as assert } from "node:assert";
import test from "node:test";
import { routedToolsExtension } from "../../extensions/crew/runner/routing-extension.mjs";

test("routing rejects before accessing the VM and reports the reason", async () => {
  const tools = new Map();
  const calls = [];
  const vm = {
    exec(argv) {
      calls.push(argv);
      return {
        async *output() {},
        then(resolve) {
          resolve({ exitCode: 0 });
        },
      };
    },
  };
  const environment = { localCwd: process.cwd(), withVm: (fn) => fn(vm) };
  routedToolsExtension(environment)({
    on() {},
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  });
  const bash = tools.get("bash");
  for (const [command, reason] of [
    ["sleep 280; tail log", /sleep/],
    ["tail -f log", /tail follow/],
    ["while true; do grep ready log; done", /polling/],
    ["sh -c 'sleep 300'", /sleep/],
  ]) {
    const result = await bash.execute("id", { command });
    assert.equal(calls.length, 0, command);
    assert.match(JSON.stringify(result), reason, command);
    assert.match(JSON.stringify(result), /request_input/, command);
  }
  for (const command of ['echo "sleep"', 'for f in a b; do grep x "$f"; done', "sleep 1"]) {
    await bash.execute("id", { command });
    assert.equal(calls.at(-1).at(-1), command);
  }
  assert.equal(calls.length, 3);
});
