import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import crewExtension from "../../extensions/crew/crew/index.ts";

function setup() {
  const tools = new Map();
  const noop = () => {};
  crewExtension({
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: noop,
    registerEntryRenderer: noop,
    registerMessageRenderer: noop,
    on: noop,
  });
  const cwd = mkdtempSync(join(tmpdir(), "crew-route-"));
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, "SPECIALIST_ROUTES"), "/src/** @snowball @unknown\n");
  return { tool: tools.get("crew_route"), cwd };
}

const run = (tool, cwd, input) => tool.execute("test", input, undefined, undefined, { cwd });

test("registered crew_route discovers policy and reports unknown specialists", async () => {
  const { tool, cwd } = setup();
  assert.ok(tool);
  assert.equal(Value.Check(tool.parameters, {}), true);
  const { details } = await run(tool, cwd, {});
  assert.deepEqual(details.rules, [{ line: 1, pattern: "/src/**", specialists: ["snowball", "unknown"] }]);
  assert.ok(Array.isArray(details.specialists.find((item) => item.name === "snowball").domains));
  assert.deepEqual(details.specialists.find((item) => item.name === "unknown"), { name: "unknown", domains: null });
});

test("registered crew_route validates paths and returns matches and unmatched paths", async () => {
  const { tool, cwd } = setup();
  assert.equal(Value.Check(tool.parameters, { paths: [] }), false);
  const input = { paths: ["src/a", "other"] };
  assert.equal(Value.Check(tool.parameters, input), true);
  const { details } = await run(tool, cwd, input);
  assert.deepEqual(details.specialists, ["snowball", "unknown"]);
  assert.deepEqual(details.matches, [
    { path: "src/a", rule: { line: 1, pattern: "/src/**" }, specialists: ["snowball", "unknown"] },
  ]);
  assert.deepEqual(details.unmatchedPaths, ["other"]);
  assert.equal("roles" in details, false);
});

test("formerly valid large inputs are accepted by the schema and bounded only on output", async () => {
  const { tool, cwd } = setup();
  for (const paths of [Array(257).fill("x"), ["x".repeat(4097)]]) {
    assert.equal(Value.Check(tool.parameters, { paths }), true);
    const { details } = await run(tool, cwd, { paths });
    assert.ok(Buffer.byteLength(JSON.stringify(details)) <= 32768);
    assert.deepEqual(details.unmatchedPaths, paths);
  }
  const paths = ["x".repeat(33000)];
  assert.equal(Value.Check(tool.parameters, { paths }), true);
  await assert.rejects(run(tool, cwd, { paths }), /output exceeds limit/i);
});
