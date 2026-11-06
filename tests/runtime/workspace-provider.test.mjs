import { strict as assert } from "node:assert";
import { MemoryProvider, VM } from "@earendil-works/gondolin";
import test from "node:test";
import { WorkspaceProvider } from "../../extensions/crew/env-runtime/lib/workspace-provider.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

// The guest's O_TRUNC arrives as: open a writer handle, then truncate through a second handle.
async function truncateThroughSecondHandle(provider) {
  await provider.writeFile("/f", Buffer.alloc(5000, 1));
  const writer = await provider.open("/f", "r+");
  const truncator = await provider.open("/f", "r+");
  await truncator.truncate(0);
  await truncator.close();
  await writer.write(Buffer.from("short"), 0, 5, 0);
  await writer.close();
  return (await provider.readFile("/f")).toString();
}

test("a truncate through one handle reaches a writer handle opened before it", async () => {
  assert.equal(await truncateThroughSecondHandle(new WorkspaceProvider()), "short");
  // The defect this guards against: plain MemoryProvider republishes the writer's stale length.
  assert.equal((await truncateThroughSecondHandle(new MemoryProvider())).length, 5000);
});

test("handles are tracked once and released on close", async () => {
  const provider = new WorkspaceProvider();
  await provider.writeFile("/f", "x".repeat(100));
  for (let i = 0; i < 200; i += 1) await (await provider.open("/f", "r+")).close();
  const writer = await provider.open("/f", "r+");
  await (await provider.open("/f", "r+")).truncate(3);
  await writer.close();
  assert.equal((await provider.readFile("/f")).toString(), "xxx");
});

test("a guest Node rewrite that shrinks a workspace file leaves no stale tail", { timeout: 90_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const workspace = new WorkspaceProvider();
  await workspace.writeFile("/f", Buffer.alloc(70000, 1));
  const vm = await VM.create({ vfs: { mounts: { "/workspace": workspace } } });
  try {
    const result = await vm.exec([
      "node",
      "-e",
      "const fs=require('fs');fs.writeFileSync('/workspace/f','short');process.stdout.write(String(fs.readFileSync('/workspace/f').length))",
    ]);
    assert.equal(result.stdout, "5", result.stderr);
    assert.equal((await workspace.readFile("/f")).toString(), "short");
  } finally {
    await vm.close();
  }
});
