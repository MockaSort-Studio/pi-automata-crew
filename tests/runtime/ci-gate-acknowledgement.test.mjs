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
      verify: async () => ({ state: "success", pullNumber: 7, gateFiles: files, headSha: head }),
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

test("gate replies require every exact path and reject ordinary follow-ups", async () => {
  const w = world();
  w.d.start();
  await settle();
  assert.match(w.results.at(-1).question, /reply `accept` followed by every file name exactly as listed/i);
  await w.reply("please continue");
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`accept ${first}.backup`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`please fix ${first}; do not accept it`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`do not accept ${first}, ${second}`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`accept ${first}`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`accept ${first}, ${second} please`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second]);
  await w.reply(`AcCePt ${first}, ${second}`);
  assert.equal(w.d.status()[0].state, "completed");
});

test("accepts exact paths containing spaces, commas, and overlapping prefixes", async () => {
  const w = world();
  const files = [".github/workflows/release checks.yml", ".github/workflows/a,b.yml", "config", "config.extra"];
  w.setFiles(files);
  w.d.start();
  await settle();
  await w.reply(`accept ${files[0]}, ${files[1]}, ${files[2]}`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, files);
  await w.reply(`accept ${files.join(", ")}`);
  assert.equal(w.d.status()[0].state, "completed");
});

test("paths cannot be synthesized by joining text around another matched path", async () => {
  const w = world();
  const files = [".github/workflows/a", ".github/workflows/b"];
  w.setFiles(files);
  w.d.start();
  await settle();
  await w.reply("accept .github/workflows/.github/workflows/ab");
  assert.deepEqual(w.results.at(-1).ci.gateFiles, files);
  await w.reply(`accept ${files[0]} ${files[0]}`);
  assert.deepEqual(w.results.at(-1).ci.gateFiles, files);
  await w.reply(`accept ${files.join(", ")}`);
  assert.equal(w.d.status()[0].state, "completed");
});

test("backtracks when a longer prefix cannot complete the reply", async () => {
  const w = world();
  const files = ["a", "a,b", "b,c"];
  w.setFiles(files);
  w.d.start();
  await settle();
  await w.reply("accept a,b,c a,b");
  assert.equal(w.d.status()[0].state, "completed");
});

test("a missing verified head fails closed", async () => {
  const w = world();
  w.setHead(undefined);
  w.d.start();
  await settle();
  assert.equal(w.d.status()[0].state, "needs_input");
  assert.match(w.results.at(-1).question, /head/);
  await w.reply(`accept ${first}, ${second}`);
  assert.equal(w.d.status()[0].state, "needs_input");
});

test("naming every file accepts them, but a new file or head asks again", async () => {
  const w = world();
  w.d.start();
  await settle();
  await w.reply(`accept ${first} ${second}`);
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
