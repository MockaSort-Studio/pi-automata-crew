import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Gondolin ships a prebuilt libkrun runner for these platforms as an optional dependency.
const KRUN_RUNNERS = {
  "darwin-arm64": "@earendil-works/gondolin-krun-runner-darwin-arm64",
  "linux-x64": "@earendil-works/gondolin-krun-runner-linux-x64",
};

// libkrun needs about half the memory of QEMU for the same guest (measured with the OS
// footprint: 100 MB against 212 MB after a real workload), runs every Gondolin feature we
// use, and needs no QEMU install. QEMU stays as the automatic fallback where no runner is
// available. HALL_VMM=qemu|krun forces one.
export function chooseVmm({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  resolve = (name) => require.resolve(`${name}/package.json`),
} = {}) {
  if (env.HALL_VMM) {
    if (!["qemu", "krun"].includes(env.HALL_VMM)) throw new Error(`HALL_VMM must be "qemu" or "krun", not "${env.HALL_VMM}"`);
    return env.HALL_VMM;
  }
  const runner = KRUN_RUNNERS[`${platform}-${arch}`];
  try {
    if (runner) return resolve(runner), "krun";
  } catch {}
  return "qemu";
}
