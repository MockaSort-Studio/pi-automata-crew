import { ReadonlyProvider, RealFSProvider } from "@earendil-works/gondolin";
import { createGuestNetwork } from "../env-runtime/lib/guest-network.mjs";
import { GUEST_WORKSPACE } from "../env-runtime/lib/gondolin-worker-paths.mjs";
import { chooseVmm } from "../env-runtime/lib/guest-vmm.mjs";
import { verifyGuestDependencyCache } from "../env-runtime/lib/repository-dependency-cache.mjs";
import { createTrackedVm } from "../env-runtime/lib/vm-lifecycle.mjs";
import { WorkspaceProvider } from "../env-runtime/lib/workspace-provider.mjs";

// VM creation is serialized process-wide: a VM's own process is identified among this process's children
// (vm-lifecycle.mjs), which is only unambiguous when creations do not overlap.
let creation = Promise.resolve();

// One agent's execution environment: a Gondolin VM that boots on first use, a host-held private workspace
// that outlives idle VM release, and a deny-by-default network. It knows nothing about Pi; the routing
// extension and any host-side tools reach the VM and the workspace only through this object.
export function createEnvironment({
  localCwd,
  label = "agent",
  seed,
  allowedHosts = [],
  secrets = {},
  onDenied,
  dependencyCache,
  idleMs = 20_000,
  createVm = createTrackedVm,
  vmm = chooseVmm(),
}) {
  const workspace = new WorkspaceProvider();
  let vm,
    starting,
    seeded,
    idleTimer,
    network,
    closed = false,
    inflight = 0;

  // Seeding is independent of the VM: host-side tools act on the workspace without ever booting it, so
  // anything that touches the workspace first waits for this. It runs once; a failure can be retried.
  const ready = () => {
    seeded ??= Promise.resolve(seed?.(workspace)).catch((error) => {
      seeded = undefined;
      throw error;
    });
    return seeded;
  };

  async function boot() {
    await ready();
    network = createGuestNetwork({ allowedHosts, secrets, onDenied });
    const created = await createVm({
      sandbox: { vmm },
      sessionLabel: `crew ${label}`,
      httpHooks: network.httpHooks,
      env: { ...network.env, XDG_CACHE_HOME: "/tmp/", npm_config_cache: "/tmp/", CACHE_DIR: "/tmp/" },
      vfs: {
        mounts: {
          [GUEST_WORKSPACE]: workspace,
          // A lockfile-keyed, read-only cache replaces only node_modules inside the private workspace.
          ...(dependencyCache
            ? {
                [`${GUEST_WORKSPACE}/node_modules`]: new ReadonlyProvider(
                  new RealFSProvider(dependencyCache.modulesPath),
                ),
              }
            : {}),
        },
      },
    });
    try {
      if (dependencyCache) await verifyGuestDependencyCache(created, dependencyCache);
      return created;
    } catch (error) {
      await created.close();
      throw error;
    }
  }

  const api = {
    localCwd,
    workspace,
    ready,
    isRunning: () => Boolean(vm),
    cancelIdle: () => clearTimeout(idleTimer),
    // Never releases mid-run or mid-tool; the workspace and secrets policy outlive the VM.
    armIdle() {
      clearTimeout(idleTimer);
      if (!(idleMs > 0) || !(vm || starting)) return;
      idleTimer = setTimeout(() => inflight === 0 && api.release().catch(() => undefined), idleMs);
      idleTimer.unref();
    },
    async withVm(use) {
      if (closed) throw new Error("Environment is closed");
      inflight += 1;
      clearTimeout(idleTimer);
      try {
        if (!vm) {
          starting ??= (creation = creation.catch(() => undefined).then(boot))
            .then((created) => (vm = created))
            .finally(() => (starting = undefined));
          await starting;
        }
        return await use(vm);
      } finally {
        inflight -= 1;
      }
    },
    async release() {
      clearTimeout(idleTimer);
      const active = vm ?? (await starting?.catch(() => undefined));
      vm = undefined;
      starting = undefined;
      for (const { name } of network?.secretManager?.listSecrets() ?? []) network.secretManager.deleteSecret(name);
      if (active) await active.close();
    },
    async close() {
      closed = true;
      await api.release();
    },
  };
  return api;
}
