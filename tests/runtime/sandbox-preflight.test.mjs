import { strict as assert } from "node:assert";
import test from "node:test";
import {
  gondolinCacheHome,
  preflightWorkerSandbox,
  requiredQemuBinary,
} from "../../.pi/extensions/hall-crew/env-runtime/lib/sandbox-preflight.mjs";

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
      verifyNix: () => calls.push("nix"),
      gondolin: { ensureGuestAssets: async () => calls.push("assets") },
    },
  );
  assert.match(environment.XDG_CACHE_HOME, /\.pi\/agent\/cache$/);
  assert.deepEqual(calls, [requiredQemuBinary(), "qemu-img", "nix", "assets"]);
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

test("preflight rejects with an install hint, before downloading assets, when Nix is absent", async () => {
  await assert.rejects(
    preflightWorkerSandbox(
      { sandbox: { kind: "gondolin" } },
      {
        verifyQemu: () => {},
        verifyQemuImage: () => {},
        verifyNix: () => {
          throw new Error("Gondolin sandbox requires Nix");
        },
        gondolin: { ensureGuestAssets: async () => assert.fail("should not download") },
      },
    ),
    /requires Nix/,
  );
});

test("a Crew's later workers reuse a recent successful preflight instead of re-spawning the checks", async (t) => {
  try {
    await preflightWorkerSandbox({ sandbox: { kind: "gondolin" } });
  } catch {
    return t.skip("QEMU, Nix or the guest assets are unavailable here");
  }
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
      verifyNix: () => calls.push("nix"),
      gondolin: { ensureGuestAssets: async () => calls.push("assets") },
    },
  );
  assert.deepEqual(calls, ["nix", "assets"]);
});
