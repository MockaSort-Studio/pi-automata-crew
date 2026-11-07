import { appendFileSync, readFileSync } from "node:fs";
import { ReadonlyProvider, RealFSProvider } from "@earendil-works/gondolin";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { GUEST_WORKSPACE } from "./gondolin-worker-paths.mjs";
import {
  editOperations,
  executeGrep,
  findOperations,
  lsOperations,
  readOperations,
  writeOperations,
} from "./gondolin-worker-operations.mjs";
import { bashOperations } from "./gondolin-worker-shell.mjs";
import { createGondolinNixLayer } from "./gondolin-nix-layer.mjs";
import { readWorkerArmoryConfig } from "./worker-armory-config.mjs";
import { verifyGuestDependencyCache, workerDependencyCache } from "./repository-dependency-cache.mjs";
import { seedRepositoryWorkspace } from "./repository-workspace.mjs";
import { WorkspaceProvider } from "./workspace-provider.mjs";
import { createTrackedVm } from "./vm-lifecycle.mjs";
import { consumeCredentialLease, revokeCredentialLease } from "./credentials.mjs";
import { lazyGuest, registerArmoryWorkerProxies } from "./guest-suite.mjs";
import { chooseVmm } from "./guest-vmm.mjs";
import { createGuestNetwork } from "./guest-network.mjs";

// A resident worker's own new_session call fires session_shutdown -> reload ->
// session_start again in this process, re-invoking this factory with a fresh `pi`.
// `vm`/`starting` are module-level so ensureVm() stays idempotent and never races a
// second, orphaned boot (the same class of bug fixed in worker-comm-extension.mjs).
let vm;
let starting;
let secretManager;
const credentialLease = consumeCredentialLease();

// A VM holds 300-450 MB of host memory, so it is released after IDLE_MS of idleness
// (never mid-run or mid-tool) and booted again, about 0.8 s, on the next tool call.
// The guest-private workspace and credential lease outlive the VM, so idle release
// loses neither. 0 disables release.
const IDLE_MS = Number(process.env.HALL_VM_IDLE_MS ?? 20_000);
let idleTimer;
let inflight = 0;
let warmSuites;
// Source and edits are guest-private. Keep this provider across idle VM release so
// a resident worker's workspace survives reboots, but never mount its host worktree.
const workspace = new WorkspaceProvider();
let workspaceSeed;

function logDeniedHost(host) {
  try {
    const { logFile } = JSON.parse(readFileSync(process.env.PI_CREW_WORKER_CONFIG, "utf8"));
    if (typeof logFile === "string")
      appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), type: "network_denied", host })}\n`);
  } catch {}
}

async function releaseVm() {
  clearTimeout(idleTimer);
  const activeVm = vm ?? (await starting?.catch(() => undefined));
  vm = undefined;
  starting = undefined;
  if (activeVm) await activeVm.close();
  for (const { name } of secretManager?.listSecrets() ?? []) secretManager.deleteSecret(name);
  secretManager = undefined;
}

function armIdleRelease() {
  clearTimeout(idleTimer);
  if (!(IDLE_MS > 0) || !(vm || starting)) return;
  idleTimer = setTimeout(() => inflight === 0 && releaseVm().catch(() => undefined), IDLE_MS);
  idleTimer.unref();
}

async function withVm(localCwd, use) {
  inflight += 1;
  try {
    return await use(await ensureVm(localCwd));
  } finally {
    inflight -= 1;
  }
}

async function startVm(localCwd) {
  const armory = readWorkerArmoryConfig();
  if (!workspaceSeed)
    workspaceSeed = seedRepositoryWorkspace(workspace, armory.repositoryAuthorization, { cwd: localCwd }).catch(
      (error) => {
        workspaceSeed = undefined;
        throw error;
      },
    );
  await workspaceSeed;
  const dependencyCache = workerDependencyCache({
    ...(process.env.PI_CREW_WORKER_CONFIG ? JSON.parse(readFileSync(process.env.PI_CREW_WORKER_CONFIG, "utf8")) : {}),
    cwd: localCwd,
  });
  const secrets = Object.fromEntries(
    (armory.network?.credentials ?? [])
      .filter((credential) => credentialLease.credentials.has(credential.environment))
      .map((credential) => [credential.environment, credentialLease.credentials.get(credential.environment)]),
  );
  // Every guest starts deny-all. The host passes only the union of its granted
  // suites' host allowlists; credentials remain separately bound to their hosts.
  const network = createGuestNetwork({
    allowedHosts: armory.network?.allowedHosts ?? [],
    secrets,
    onDenied: logDeniedHost,
  });
  secretManager = network.secretManager;
  const created = await createTrackedVm({
    sandbox: { vmm: chooseVmm() },
    sessionLabel: `crew worker ${process.env.PI_SDK_ACTOR_ID ?? "unknown"}`,
    httpHooks: network.httpHooks,
    env: network.env,
    vfs: {
      mounts: {
        [GUEST_WORKSPACE]: workspace,
        // A required implementation cache is a lockfile-keyed, read-only child mount
        // in the otherwise private guest workspace.
        ...(dependencyCache
          ? {
              [`${GUEST_WORKSPACE}/node_modules`]: new ReadonlyProvider(
                new RealFSProvider(dependencyCache.modulesPath),
              ),
            }
          : {}),
        ...(armory.paths.length ? createGondolinNixLayer(armory.paths) : {}),
      },
    },
  });
  try {
    if (dependencyCache) await verifyGuestDependencyCache(created, dependencyCache);
    vm = created;
    return created;
  } catch (error) {
    await created.close();
    throw error;
  }
}

async function ensureVm(localCwd) {
  clearTimeout(idleTimer);
  if (vm) return vm;
  if (!starting) starting = startVm(localCwd).finally(() => (starting = undefined));
  return starting;
}

export default function gondolinWorkerExtension(pi) {
  const localCwd = process.cwd();
  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);
  const localGrep = createGrepTool(localCwd);
  const localFind = createFindTool(localCwd);
  const localLs = createLsTool(localCwd);

  const routed = (local, createOperations) => ({
    ...local,
    async execute(id, params, signal, onUpdate) {
      return withVm(localCwd, (activeVm) => createOperations(activeVm).execute(id, params, signal, onUpdate));
    },
  });

  pi.on("session_start", async () => {
    try {
      await ensureVm(localCwd);
      const armory = readWorkerArmoryConfig();
      // The suite's tools are described by the guest once; the proxies then reach whichever
      // VM is current, so releasing and re-booting the VM never re-registers anything.
      if (armory.suites.length) {
        warmSuites = (
          await registerArmoryWorkerProxies(pi, { config: armory, guest: lazyGuest(() => ensureVm(localCwd)) })
        ).warm;
        armIdleRelease();
      }
    } catch (error) {
      // Pi logs an error thrown in a handler and carries on, which would leave a worker
      // that reports ready with its sandboxed tools silently missing. End it instead:
      // the launch then fails at once (see Runtime.launchCrew) rather than degrading.
      console.error(`Gondolin sandbox setup failed: ${error?.message ?? error}`);
      process.exit(70);
    }
  });
  // A run is starting: never release mid-run, and have the VM and the suite ready by the
  // time the model's first tool call arrives. Warming is best effort.
  pi.on("agent_start", () => {
    clearTimeout(idleTimer);
    warmSuites?.().catch(() => undefined);
  });
  pi.on("agent_settled", armIdleRelease);
  // Only a real process-ending shutdown closes the VM -- see the
  // module-level comment above for why the VM itself survives a reload.
  pi.on("session_shutdown", async (event) => {
    if (event.reason !== "quit") return;
    await releaseVm();
    revokeCredentialLease(credentialLease);
  });

  pi.registerTool(
    routed(localRead, (activeVm) =>
      createReadTool(GUEST_WORKSPACE, { operations: readOperations(activeVm, localCwd) }),
    ),
  );
  pi.registerTool(
    routed(localWrite, (activeVm) =>
      createWriteTool(GUEST_WORKSPACE, { operations: writeOperations(activeVm, localCwd) }),
    ),
  );
  pi.registerTool(
    routed(localEdit, (activeVm) =>
      createEditTool(GUEST_WORKSPACE, { operations: editOperations(activeVm, localCwd) }),
    ),
  );
  pi.registerTool(
    routed(localBash, (activeVm) =>
      createBashTool(GUEST_WORKSPACE, { operations: bashOperations(activeVm, localCwd) }),
    ),
  );
  pi.registerTool(
    routed(localLs, (activeVm) => createLsTool(GUEST_WORKSPACE, { operations: lsOperations(activeVm, localCwd) })),
  );
  pi.registerTool(
    routed(localFind, (activeVm) =>
      createFindTool(GUEST_WORKSPACE, { operations: findOperations(activeVm, localCwd) }),
    ),
  );
  pi.registerTool({
    ...localGrep,
    async execute(_id, params, signal) {
      return withVm(localCwd, (activeVm) => executeGrep(activeVm, localCwd, params, signal));
    },
  });
  pi.on("user_bash", async () => ({ operations: bashOperations(await ensureVm(localCwd), localCwd) }));
}
