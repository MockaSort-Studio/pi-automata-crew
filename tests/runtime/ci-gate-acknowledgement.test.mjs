import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDispatcher } from "../../extensions/crew/runner/dispatcher.mjs";

const handle = "developer-alpha-00";
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const first = ".prettierignore";
const second = ".github/workflows/ci.yml";
const code = (head, files) =>
  createHash("sha256")
    .update(`${head}\n${[...files].sort().join("\n")}`)
    .digest("hex")
    .slice(0, 8);

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

test("only the exact confirmation phrase accepts the asked files", async () => {
  const w = world();
  const files = [first, second];
  const correct = code("head-1", files);
  w.d.start();
  await settle();
  assert.match(w.results.at(-1).question, new RegExp(`reply \u0060accept ${correct}\u0060`, "i"));
  for (const reply of [
    "accept deadbeef",
    `accept ${code("head-1", [first])}`,
    `accept ${code("head-2", files)}`,
    correct,
    `accept ${correct} please`,
    `please fix ${first}; accept ${correct}`,
    `do not accept ${correct}`,
    `accept ${first}, ${second}`,
  ]) {
    await w.reply(reply);
    assert.deepEqual(w.results.at(-1).ci.gateFiles, files, reply);
  }
  await w.reply(` AcCePt ${correct} `);
  assert.equal(w.d.status()[0].state, "completed");
});

test("a missing verified head fails closed", async () => {
  const w = world();
  w.setHead(undefined);
  w.d.start();
  await settle();
  assert.equal(w.d.status()[0].state, "needs_input");
  assert.match(w.results.at(-1).question, /head/);
  await w.reply("accept deadbeef");
  assert.equal(w.d.status()[0].state, "needs_input");
});

test("new files and heads require their own codes", async () => {
  const w = world();
  w.d.start();
  await settle();
  await w.reply(`accept ${code("head-1", [first, second])}`);
  assert.equal(w.d.status()[0].state, "completed");
  w.setFiles([first, second, "package.json"]);
  await w.reply("add a file");
  assert.deepEqual(w.results.at(-1).ci.gateFiles, ["package.json"]);
  await w.reply(`accept ${code("head-1", ["package.json"])}`);
  assert.equal(w.d.status()[0].state, "completed");
  w.setHead("head-2");
  await w.reply("new head");
  assert.deepEqual(w.results.at(-1).ci.gateFiles, [first, second, "package.json"]);
  await w.reply(`accept ${code("head-1", [first, second, "package.json"])}`);
  assert.equal(w.d.status()[0].state, "needs_input");
  await w.reply(`accept ${code("head-2", [first, second, "package.json"])}`);
  assert.equal(w.d.status()[0].state, "completed");
});

test("hundreds of overlapping paths do not cause expensive reply parsing", { timeout: 2000 }, async () => {
  const w = world();
  const files = Array.from({ length: 500 }, (_, i) => `.eslintrc${"a".repeat(i)}`);
  w.setFiles(files);
  w.d.start();
  await settle();
  await w.reply(`accept ${files.join("")}`);
  assert.equal(w.d.status()[0].state, "needs_input");
  await w.reply(`accept ${code("head-1", files)}`);
  assert.equal(w.d.status()[0].state, "completed");
});
