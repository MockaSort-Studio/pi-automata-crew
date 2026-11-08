import { strict as assert } from "node:assert";
import { MemoryProvider, VM } from "@earendil-works/gondolin";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { workspaceFs } from "../../extensions/crew/runner/workspace-fs.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

test("workspace adapter symlinks cannot read host files", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "workspace-symlink-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hostFile = join(dir, "host-secret");
  writeFileSync(hostFile, "host-only");
  const fs = workspaceFs(new MemoryProvider()).promises;
  await fs.writeFile("/inside.md", "workspace-only");
  await fs.symlink("/inside.md", "/inside-link");
  await fs.symlink(hostFile, "/absolute-link");
  await fs.symlink(`../../../../${hostFile.slice(1)}`, "/relative-link");
  await fs.symlink(dir, "/directory-link");
  assert.equal((await fs.readFile("/inside-link")).toString(), "workspace-only");
  for (const path of ["/absolute-link", "/relative-link", `/directory-link/${basename(hostFile)}`]) {
    await assert.rejects(fs.readFile(path), { code: "ENOENT" });
  }
});

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
