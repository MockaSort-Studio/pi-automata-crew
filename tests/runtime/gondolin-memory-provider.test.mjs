import { strict as assert } from "node:assert";
import { MemoryProvider, VM } from "@earendil-works/gondolin";
import test from "node:test";
import { skipLiveGondolin } from "./live-gondolin.mjs";

// The guest's O_TRUNC reaches the host as: a writer handle is open, then a truncate arrives through a second
// handle. Gondolin 0.12 republished the writer's stale copy, so a shorter rewrite kept the old tail; we carried a
// subclass to work around it. Fixed upstream in 0.14: these tests guard that we never go back to a version that
// has the defect without noticing (the workspace is a plain MemoryProvider).
test("a truncate through one handle reaches a writer handle opened before it", async () => {
  const provider = new MemoryProvider();
  await provider.writeFile("/f", Buffer.alloc(5000, 1));
  const writer = await provider.open("/f", "r+");
  const truncator = await provider.open("/f", "r+");
  await truncator.truncate(0);
  await truncator.close();
  await writer.write(Buffer.from("short"), 0, 5, 0);
  await writer.close();
  assert.equal((await provider.readFile("/f")).toString(), "short");
});

test("a guest Node rewrite that shrinks a workspace file leaves no stale tail", { timeout: 90_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const workspace = new MemoryProvider();
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
