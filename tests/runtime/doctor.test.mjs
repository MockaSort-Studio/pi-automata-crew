import { strict as assert } from "node:assert";
import test from "node:test";
import { formatDoctor, runDoctor } from "../../extensions/crew/env-runtime/lib/doctor.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

const good = (extra = {}) => ({
  env: { HALL_GITHUB_TOKEN: "ghp_secret_value_123" },
  nodeVersion: "24.1.0",
  findHostPi: () => "file:///pi/package.json",
  chooseVmm: () => "krun",
  runs: () => true,
  ensureGuestAssets: async () => {},
  bootVm: async () => {},
  armoryRelease: async () => "https://example.test/releases/armory-abc123def456",
  ...extra,
});
const byName = (report, name) => report.checks.find((check) => check.name === name);

test("a healthy machine is ready, and Nix is not asked for", async () => {
  const report = await runDoctor({ deps: good() });
  assert.equal(report.ok, true);
  assert.equal(
    report.checks.some((check) => /nix/i.test(check.name)),
    false,
  );
  const text = formatDoctor(report);
  assert.match(text, /Ready: a Crew can run here\. \(Nix is not needed\.\)/);
  assert.match(text, /release armory-abc123def456/);
});

test("each failure names what was found and what to do, and the token value is never printed", async () => {
  const cases = [
    [{ nodeVersion: "22.3.0" }, "Node 24 or newer", /found 22\.3\.0/, /Install Node 24/],
    [{ findHostPi: () => undefined }, "Pi is installed", /not found/, /Install Pi/],
    [{ runs: (command) => command !== "git" }, "git", /did not run/, /Install git/],
    [
      { chooseVmm: () => "qemu", runs: (command) => command === "git" },
      "VM monitor",
      /qemu-system-.* was not found/,
      /Install QEMU/,
    ],
    [
      {
        ensureGuestAssets: async () => {
          throw new Error("download failed: 403");
        },
      },
      "Guest image",
      /download failed: 403/,
      undefined,
    ],
    [
      {
        bootVm: async () => {
          throw new Error("krun exited 1");
        },
      },
      "A VM boots and runs a command",
      /krun exited 1/,
      undefined,
    ],
    [
      {
        armoryRelease: async () => {
          throw new Error("offline");
        },
      },
      "Armory source is reachable",
      /offline/,
      undefined,
    ],
  ];
  for (const [override, name, found, fix] of cases) {
    const report = await runDoctor({ deps: good(override) });
    const item = byName(report, name);
    assert.equal(item.ok, false, name);
    assert.match(item.detail, found, name);
    if (fix) assert.match(item.fix, fix, name);
    assert.equal(report.ok, false, `${name} blocks a Crew`);
    assert.match(formatDoctor(report), /1 problem to fix before a Crew can run\./);
    assert.doesNotMatch(JSON.stringify(report), /ghp_secret_value_123/);
  }
});

test("GitHub is optional: without a credential or gh the machine can still run a Crew, and the output says why", async () => {
  const noToken = await runDoctor({ deps: good({ env: {} }) });
  assert.equal(noToken.ok, true);
  assert.match(formatDoctor(noToken), /– GitHub credential: HALL_GITHUB_TOKEN is not set\n    → Export a token/);
  const noGh = await runDoctor({ deps: good({ runs: (command) => command !== "gh" }) });
  assert.match(byName(noGh, "GitHub credential").detail, /gh CLI did not run/);
  assert.equal(noGh.ok, true);
});

test("without a boot check no VM is started", async () => {
  let booted = false;
  const report = await runDoctor({ boot: false, deps: good({ bootVm: async () => (booted = true) }) });
  assert.equal(booted, false);
  assert.equal(byName(report, "A VM boots and runs a command"), undefined);
});

test("on this machine the real checks pass: a VM boots and answers", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const report = await runDoctor({ deps: { findHostPi: () => "file:///pi/package.json" } });
  const failed = report.checks.filter((check) => !check.ok && check.name !== "GitHub credential");
  assert.deepEqual(failed, [], formatDoctor(report));
  assert.match(byName(report, "A VM boots and runs a command").detail, /^\d+\.\ds$/);
});
