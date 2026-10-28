import { strict as assert } from "node:assert";
import test from "node:test";
import { chooseVmm } from "../../.pi/extensions/hall-crew/env-runtime/lib/guest-vmm.mjs";

const present = () => "/somewhere/package.json";
const absent = () => {
  throw new Error("MODULE_NOT_FOUND");
};

test("libkrun is chosen where Gondolin's prebuilt runner is installed", () => {
  assert.equal(chooseVmm({ env: {}, platform: "darwin", arch: "arm64", resolve: present }), "krun");
  assert.equal(chooseVmm({ env: {}, platform: "linux", arch: "x64", resolve: present }), "krun");
});

test("QEMU is the automatic fallback when no runner is installed or the platform has none", () => {
  assert.equal(chooseVmm({ env: {}, platform: "darwin", arch: "arm64", resolve: absent }), "qemu");
  assert.equal(chooseVmm({ env: {}, platform: "linux", arch: "arm64", resolve: present }), "qemu");
  assert.equal(chooseVmm({ env: {}, platform: "darwin", arch: "x64", resolve: present }), "qemu");
});

test("HALL_VMM forces a backend and rejects anything else", () => {
  assert.equal(chooseVmm({ env: { HALL_VMM: "qemu" }, platform: "darwin", arch: "arm64", resolve: present }), "qemu");
  assert.equal(chooseVmm({ env: { HALL_VMM: "krun" }, platform: "linux", arch: "arm64", resolve: absent }), "krun");
  assert.throws(() => chooseVmm({ env: { HALL_VMM: "firecracker" } }), /HALL_VMM must be/);
});
