import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Runtime } from "../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs";
import { listOwners, recordOwner } from "../../.pi/extensions/hall-crew/crew-runtime/lib/lifecycle-registry.mjs";

// Each test gets its own temp cwd, not the real repo root: listOwners()
// scans a real directory on disk (.pi/runtime/lifecycle-owners under cwd),
// and the repo root can genuinely have another live Runtime's owner file
// in it already -- e.g. the Main session driving this very test run. A
// shared/real cwd makes these assertions flaky against nothing but an
// honest environmental collision, not a code bug.
const withTempCwd = async (run) => {
  const cwd = mkdtempSync(join(tmpdir(), "lifecycle-owner-test-"));
  try {
    await run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test("Runtime records and clears its own Lifecycle server's owner file", async () =>
  withTempCwd(async (cwd) => {
    const runtime = new Runtime(cwd);
    try {
      await runtime.list(); // triggers #ensureLifecycle() without spawning any worker
      const owners = await listOwners(cwd);
      assert.equal(owners.length, 1);
      assert.equal(owners[0].hostPid, process.pid);
    } finally {
      await runtime.stop();
    }
    assert.deepEqual(await listOwners(cwd), []);
  }));

test("Runtime reaps a stale owner record from a dead host session before spawning its own", async () =>
  withTempCwd(async (cwd) => {
    await recordOwner(cwd, { pid: 999999, hostPid: 999999, port: 1 });
    const runtime = new Runtime(cwd);
    try {
      await runtime.list();
      const owners = await listOwners(cwd);
      // The stale record (dead pid 999999) is gone; only this Runtime's live
      // Lifecycle server owner record remains.
      assert.equal(
        owners.some((owner) => owner.pid === 999999),
        false,
      );
    } finally {
      await runtime.stop();
    }
  }));
