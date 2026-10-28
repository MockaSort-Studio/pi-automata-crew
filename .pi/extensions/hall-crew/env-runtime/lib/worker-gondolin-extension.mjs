import { RealFSProvider, ShadowProvider, VM, createHttpHooks, createShadowPathPredicate } from "@earendil-works/gondolin";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { HIDDEN_WORKSPACE_PATHS, GUEST_WORKSPACE } from "./gondolin-worker-paths.mjs";
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
import { consumeCredentialLease, revokeCredentialLease } from "./credentials.mjs";
import { lazyGuest, registerArmoryWorkerProxies } from "./guest-suite.mjs";
import { chooseVmm } from "./guest-vmm.mjs";

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
// Workspace files live on the host and the credential lease outlives the VM, so
// nothing is lost. 0 disables release.
const IDLE_MS = Number(process.env.HALL_VM_IDLE_MS ?? 20_000);
let idleTimer;
let inflight = 0;
let warmSuites;

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
  const secrets = Object.fromEntries(
    (armory.network?.credentials ?? [])
      .filter((credential) => credentialLease.credentials.has(credential.environment))
      .map((credential) => [credential.environment, credentialLease.credentials.get(credential.environment)]),
  );
  // No global egress policy is imposed here. Gondolin substitutes each secret
  // only at its individually bound hosts.
  const network = Object.keys(secrets).length ? createHttpHooks({ secrets }) : undefined;
  secretManager = network?.secretManager;
  const created = await VM.create({
    sandbox: { vmm: chooseVmm() },
    sessionLabel: `crew worker ${process.env.PI_SDK_ACTOR_ID ?? "unknown"}`,
    ...(network ? { httpHooks: network.httpHooks, env: network.env } : {}),
    vfs: {
      mounts: {
        [GUEST_WORKSPACE]: new ShadowProvider(new RealFSProvider(localCwd), {
          shouldShadow: createShadowPathPredicate(HIDDEN_WORKSPACE_PATHS),
        }),
        ...(armory.paths.length ? createGondolinNixLayer(armory.paths) : {}),
      },
    },
  });
  vm = created;
  return created;
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
        warmSuites = (await registerArmoryWorkerProxies(pi, { config: armory, guest: lazyGuest(() => ensureVm(localCwd)) })).warm;
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
