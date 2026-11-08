import { strict as assert } from "node:assert";
import test from "node:test";
import { createDispatcher } from "../../extensions/crew/runner/dispatcher.mjs";

const handle = "developer-alpha-00";
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const first = ".prettierignore";
const second = ".github/workflows/ci.yml";

// Like the dispatcher test's scripted agent, each turn completes and verifies its current evidence.
function world() {
  let files = [first, second];
  let head = "head-1";
  const results = [];
  const d = createDispatcher({
    members: [{ handle, task: "work" }],
    createAgent: async () => ({
      run: { prompt: async () => ({ status: "completed", evidence: { pushed: { commit: head } } }) },
      verify: async () => ({ state: "success", pullNumber: 7, gateFiles: files }),
    }),
    onResult: (h, result) => results.push(result),
  });
  return {
    d,
    results,
    setFiles: (value) => (files = value),
    setHead: (value) => (head = value),
    async reply(text) {
      d.message(handle, text);
      await settle();
    },
  };
}

test("gate replies must name exact paths, and partial acknowledgement leaves the rest", async () => {
  const w = world();
  w.d.start();
  await settle();
  assert.match(w.results.at(-1).question, /name.*files/i);
  await w.reply("please continue");
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`accept ${first}.backup`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`accept ${first}`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [second]);
  await w.reply(`accept ${second}`);
  assert.equal(w.d.status()[0].state, "completed");
});

test("naming every file accepts them, but a new file or head asks again", async () => {
  const w = world();
  w.d.start();
  await settle();
  await w.reply(`accept ${first} and ${second}`);
  assert.equal(w.d.status()[0].state, "completed");
  w.setFiles([first, second, "package.json"]);
  await w.reply("add a file");
  assert.deepEqual(w.results.at(-1).ci.gateFiles, ["package.json"]);
  await w.reply("accept package.json");
  assert.equal(w.d.status()[0].state, "completed");
  w.setHead("head-2");
  await w.reply("new head");
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second, "package.json"]);
});
