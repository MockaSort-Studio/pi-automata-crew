import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  gondolinCacheHome,
  preflightWorkerSandbox,
  requiredQemuBinary,
} from "../../extensions/crew/env-runtime/lib/sandbox-preflight.mjs";

test("uses the Pi cache only when no XDG cache is configured", () => {
  assert.equal(gondolinCacheHome({ XDG_CACHE_HOME: "/shared-cache" }), "/shared-cache");
  assert.match(gondolinCacheHome({}), /\.pi\/agent\/cache$/);
});

test("selects the QEMU binary for the host architecture", () => {
  assert.equal(requiredQemuBinary("darwin", "arm64"), "qemu-system-aarch64");
  assert.equal(requiredQemuBinary("linux", "x64"), "qemu-system-x86_64");
});

test("preflight verifies QEMU then downloads verified guest assets into the chosen cache", async () => {
  const environment = {};
  const calls = [];
  await preflightWorkerSandbox(
    { sandbox: { kind: "gondolin" } },
    {
      environment,
      vmm: "qemu",
      verifyQemu: (binary) => calls.push(binary),
      verifyQemuImage: () => calls.push("qemu-img"),
      gondolin: { ensureGuestAssets: async () => calls.push("assets") },
    },
  );
  assert.match(environment.XDG_CACHE_HOME, /\.pi\/agent\/cache$/);
  assert.deepEqual(calls, [requiredQemuBinary(), "qemu-img", "assets"]);
});

test("preflight does not download assets if QEMU is unavailable", async () => {
  await assert.rejects(
    preflightWorkerSandbox(
      { sandbox: { kind: "gondolin" } },
      {
        vmm: "qemu",
        verifyQemu: () => {
          throw new Error("QEMU absent");
        },
        verifyQemuImage: () => assert.fail("should not verify image tool"),
        gondolin: { ensureGuestAssets: async () => assert.fail("should not download") },
      },
    ),
    /QEMU absent/,
  );
});

test("a Crew's later workers reuse a recent successful preflight instead of re-spawning the checks", async () => {
  const calls = [];
  const dependencies = {
    memo: {},
    environment: {},
    vmm: "qemu",
    verifyQemu: () => calls.push("qemu"),
    verifyQemuImage: () => calls.push("image"),
    gondolin: { ensureGuestAssets: async () => calls.push("assets") },
  };
  await preflightWorkerSandbox({ sandbox: { kind: "gondolin" } }, dependencies);
  await preflightWorkerSandbox({ sandbox: { kind: "gondolin" } }, dependencies);
  assert.deepEqual(calls, ["qemu", "image", "assets"]);
});

test("an expired preflight is checked again", async () => {
  const calls = [];
  const dependencies = {
    memo: {},
    environment: {},
    vmm: "krun",
    gondolin: { ensureGuestAssets: async () => calls.push("assets") },
  };
  await preflightWorkerSandbox({ sandbox: { kind: "gondolin" } }, dependencies);
  dependencies.memo.verifiedAt = Date.now() - 30_001;
  await preflightWorkerSandbox({ sandbox: { kind: "gondolin" } }, dependencies);
  assert.deepEqual(calls, ["assets", "assets"]);
});

test("a failed preflight is retried rather than memoized", async () => {
  const calls = [];
  let fail = true;
  const dependencies = {
    memo: {},
    environment: {},
    vmm: "krun",
    gondolin: {
      ensureGuestAssets: async () => {
        calls.push("assets");
        if (fail) throw new Error("unavailable");
      },
    },
  };
  const config = { sandbox: { kind: "gondolin" } };
  await assert.rejects(preflightWorkerSandbox(config, dependencies), /unavailable/);
  fail = false;
  await preflightWorkerSandbox(config, dependencies);
  await preflightWorkerSandbox(config, dependencies);
  assert.deepEqual(calls, ["assets", "assets"]);
});

test("real preflight reuses a recent success", async () => {
  await preflightWorkerSandbox({ sandbox: { kind: "gondolin" } });
  const started = performance.now();
  await preflightWorkerSandbox({ sandbox: { kind: "gondolin" } });
  assert.ok(performance.now() - started < 20, `second preflight took ${Math.round(performance.now() - started)} ms`);
});

test("libkrun needs no QEMU: its absence is never checked", async () => {
  const calls = [];
  await preflightWorkerSandbox(
    { sandbox: { kind: "gondolin" } },
    {
      environment: {},
      vmm: "krun",
      verifyQemu: () => assert.fail("QEMU must not be required for libkrun"),
      verifyQemuImage: () => assert.fail("qemu-img must not be required for libkrun"),
      gondolin: { ensureGuestAssets: async () => calls.push("assets") },
    },
  );
  assert.deepEqual(calls, ["assets"]);
});
