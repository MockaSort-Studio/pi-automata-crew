import { spawnSync } from "node:child_process";
import { resolveArmoryCatalog } from "./armory-artifacts.mjs";
import { chooseVmm } from "./guest-vmm.mjs";
import { requiredQemuBinary } from "./sandbox-preflight.mjs";
import { createTrackedVm } from "./vm-lifecycle.mjs";
import { findHostPi } from "../../runner/pi-host.mjs";

// GitHub is the one optional piece: a crew that does not use it runs without.
export const OPTIONAL = new Set(["GitHub credential"]);

const runs = (command, args = ["--version"]) => {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
};

const defaults = {
  env: process.env,
  nodeVersion: process.versions.node,
  findHostPi,
  chooseVmm,
  runs,
  async ensureGuestAssets() {
    await (await import("@earendil-works/gondolin")).ensureGuestAssets();
  },
  async bootVm(vmm) {
    const vm = await createTrackedVm({ sandbox: { vmm } });
    try {
      const result = await vm.exec(["/bin/sh", "-c", "echo crew-doctor-ok"]);
      if (!String(result.stdout ?? result.output ?? "").includes("crew-doctor-ok"))
        throw new Error("the guest did not answer");
    } finally {
      await vm.close();
    }
  },
  armoryCatalog: resolveArmoryCatalog,
};

// Can this machine run a Crew? Every check says what it found and, when it fails, what to do. Nothing is
// changed and no credential value is read out: the token is only reported as set or not. Nix is not needed.
export async function runDoctor({ boot = true, deps = {} } = {}) {
  const d = { ...defaults, ...deps };
  const checks = [];
  const check = async (name, probe) => {
    try {
      const detail = await probe();
      checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
    } catch (error) {
      checks.push({ name, ok: false, detail: String(error?.message ?? error).slice(0, 300), fix: error?.fix });
    }
  };
  const fail = (message, fix) => Object.assign(new Error(message), { fix });

  await check("Node 24 or newer", () => {
    if (Number(d.nodeVersion.split(".")[0]) < 24) throw fail(`found ${d.nodeVersion}`, "Install Node 24 or newer.");
    return d.nodeVersion;
  });
  await check("Pi is installed", () => {
    if (!d.findHostPi()) throw fail("the running Pi's package was not found", "Install Pi and start the Crew from it.");
  });
  await check("git", () => {
    if (!d.runs("git")) throw fail("git did not run", "Install git: Crew builds each repository's seed with it.");
  });
  let vmm;
  await check("VM monitor", () => {
    vmm = d.chooseVmm({ env: d.env });
    if (vmm === "qemu" && !d.runs(requiredQemuBinary()))
      throw fail(
        `${requiredQemuBinary()} was not found`,
        "Install QEMU (macOS: brew install qemu), or use a platform with libkrun.",
      );
    return vmm;
  });
  await check("Guest image", async () => {
    await d.ensureGuestAssets();
  });
  if (boot)
    await check("A VM boots and runs a command", async () => {
      const started = Date.now();
      await d.bootVm(vmm);
      return `${((Date.now() - started) / 1000).toFixed(1)}s`;
    });
  let cachedCatalog;
  await check("Armory source is reachable", async () => {
    const catalog = await d.armoryCatalog();
    if (catalog.fromCache) {
      cachedCatalog = true;
      return `cached revision ${catalog.revision}, cached at ${catalog.cachedAt} (offline; possibly stale)`;
    }
    return `release armory-${catalog.revision}`;
  });
  if (cachedCatalog) checks[checks.length - 1].name = "Armory catalog is cached (offline)";
  await check("GitHub credential", () => {
    if (!d.env.HALL_GITHUB_TOKEN)
      throw fail(
        "HALL_GITHUB_TOKEN is not set",
        "Export a token to let members use GitHub tools. Crews without GitHub work without it.",
      );
    if (!d.runs("gh")) throw fail("the gh CLI did not run", "Install the GitHub CLI: GitHub tools run it on the host.");
    return "set";
  });
  return { ok: checks.every((item) => item.ok || OPTIONAL.has(item.name)), checks };
}

export function formatDoctor({ checks }) {
  const lines = checks.map(({ name, ok, detail, fix }) => {
    const optional = !ok && OPTIONAL.has(name);
    const mark = ok ? "✔" : optional ? "–" : "✖";
    return `${mark} ${name}${detail ? `: ${detail}` : ""}${!ok && fix ? `\n    → ${fix}` : ""}`;
  });
  const blocking = checks.filter((item) => !item.ok && !OPTIONAL.has(item.name));
  lines.push(
    "",
    blocking.length
      ? `${blocking.length} problem${blocking.length === 1 ? "" : "s"} to fix before a Crew can run.`
      : "Ready: a Crew can run here. (Nix is not needed.)",
  );
  return lines.join("\n");
}
