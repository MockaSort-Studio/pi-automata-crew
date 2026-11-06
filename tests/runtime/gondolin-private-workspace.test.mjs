import { strict as assert } from "node:assert";
import { MemoryProvider, VM } from "@earendil-works/gondolin";
import test from "node:test";
import { skipLiveGondolin } from "./live-gondolin.mjs";

test("a private guest workspace survives VM release without a host workspace mount", { timeout: 90_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const workspace = new MemoryProvider();
  let vm;
  try {
    vm = await VM.create({ vfs: { mounts: { "/workspace": workspace } } });
    assert.equal((await vm.exec("mkdir -p /workspace/src && printf private >/workspace/src/marker")).exitCode, 0);
    await vm.close();
    vm = await VM.create({ vfs: { mounts: { "/workspace": workspace } } });
    const restored = await vm.exec("cat /workspace/src/marker");
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(restored.stdout, "private");
  } finally {
    await vm?.close();
  }
});
