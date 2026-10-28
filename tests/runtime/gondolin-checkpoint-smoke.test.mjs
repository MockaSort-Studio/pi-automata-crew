import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VM, VmCheckpoint } from "@earendil-works/gondolin";

test("a Gondolin disk checkpoint restores a private VM overlay", { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "gondolin-checkpoint-"));
  const checkpointPath = join(directory, "profile.qcow2");
  let vm;
  try {
    vm = await VM.create({});
    const written = await vm.exec("mkdir -p /opt/hall && printf sealed > /opt/hall/marker && sync");
    assert.equal(written.exitCode, 0, written.stderr);
    await vm.checkpoint(checkpointPath);
    vm = await VmCheckpoint.load(checkpointPath).resume({});
    const restored = await vm.exec("cat /opt/hall/marker");
    assert.equal(restored.exitCode, 0, restored.stderr);
    assert.equal(restored.stdout, "sealed");
    await vm.exec("printf private > /opt/hall/marker && sync");
    await vm.close();
    vm = await VmCheckpoint.load(checkpointPath).resume({});
    const untouched = await vm.exec("cat /opt/hall/marker");
    assert.equal(untouched.exitCode, 0, untouched.stderr);
    assert.equal(untouched.stdout, "sealed");
  } finally {
    await vm?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
