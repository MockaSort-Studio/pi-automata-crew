import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { boundedText, mapWorkerEvent } from "./worker-events.mjs";
import { resolveArmoryCatalog } from "../../env-runtime/lib/armory-artifacts.mjs";
import { acquireNixGuestSuites } from "../../env-runtime/lib/armory-nix.mjs";
import { leaseFromEnvironment, revokeCredentialLease, serializeLease } from "../../env-runtime/lib/credentials.mjs";
import { credentialPolicyForSuites } from "../../env-runtime/credential-policy.mjs";

const configPath = resolve(process.argv[2]);
const config = JSON.parse(readFileSync(configPath, "utf8"));

async function prepareArmory(config) {
  if (!Array.isArray(config.armory?.requests) || !config.armory.requests.length) return undefined;
  const catalog = await resolveArmoryCatalog(config.armory.catalog);
  const suites = await acquireNixGuestSuites({ catalog, requests: config.armory.requests });
  const credentials = credentialPolicyForSuites(suites.map((suite) => suite.suite));
  return {
    catalogRevision: catalog.revision,
    nixPaths: [...new Set(suites.flatMap((suite) => suite.paths))].sort(),
    suites: suites.map(({ suite, rootPath, tools }) => ({ suite, rootPath, tools })),
    network: { credentials },
  };
}

config.armory = await prepareArmory(config);
// The child Pi extensions read this same trusted worker config. Persist the
// prepared lease projection, never the mutable catalog channel, before Pi is
// spawned so they receive only exact paths and approved grants.
writeFileSync(configPath, JSON.stringify(config));
const startedAt = Date.now();
const boundedError = (value) => boundedText(value, 4000);
const log = (event) =>
  appendFileSync(config.logFile, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
const lifecycleTools = config.comm ? ["lifecycle_update"] : [];
const tools = [
  ...new Set([
    ...(config.tools ?? []),
    ...(config.commTools ?? ["comm_notify", "comm_request", "comm_reply"]),
    ...lifecycleTools,
  ]),
];
const args = [
  "--mode",
  "rpc",
  "--no-session",
  // A worker must not load the project-local files in its worktree: Pi would
  // auto-discover the worktree's copy of .pi/extensions and load the whole Crew
  // extension (monitor, launch tools, runtime tools) that no worker can use, costing
  // about 0.3 s and 50 MB per worker. User-level extensions (for example provider
  // authentication) and the explicit --extension paths below still load, which is why
  // this is --no-approve and not --no-extensions.
  "--no-approve",
  "--tools",
  tools.join(","),
  "--extension",
  resolve(import.meta.dirname, "worker-comm-extension.mjs"),
];
if (config.sandbox?.kind === "gondolin") {
  args.push(
    "--extension",
    resolve(config.extensionCwd, ".pi", "extensions", "hall-crew", "env-runtime", "lib", "worker-gondolin-extension.mjs"),
  );
}
for (const extensionPath of config.extensionPaths ?? []) args.push("--extension", resolve(config.cwd, extensionPath));
if (config.model) args.push("--model", config.model);
if (config.thinking) args.push("--thinking", config.thinking);
// Credential values never enter worker.json. Lease them from the environment, which also
// removes the variables, and hand the child Pi only the lease consumed by the Gondolin
// extension.
const credentialLease = leaseFromEnvironment(config.armory?.network?.credentials ?? []);
const child = spawn("pi", args, {
  cwd: config.cwd,
  // fd 3 is a one-shot private credential channel, never an environment value.
  stdio: ["pipe", "pipe", "pipe", "pipe"],
  env: { ...process.env, PI_CREW_WORKER_CONFIG: configPath },
});
child.stdio[3].end(serializeLease(credentialLease));
let buffer = "";
let startupSent = false;
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const startsPrompt = !config.resident || config.initialTurn === "startup";
const sendStartupPrompt = () => {
  if (!startsPrompt || startupSent) return;
  startupSent = true;
  send({ id: "initial", type: "prompt", message: config.task });
};
child.stdout.on("data", (chunk) => {
  buffer += String(chunk);
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    try {
      const message = JSON.parse(line);
      if (message.type === "response" && message.id === "worker-session") {
        log({ type: "worker_session", success: message.success });
        if (message.success) sendStartupPrompt();
      }
      const entry = mapWorkerEvent(message);
      if (entry) log(entry);
    } catch {}
  }
});
child.stderr.on("data", (chunk) => log({ type: "agent_error", message: boundedError(chunk) }));
child.once("error", (error) => log({ type: "agent_error", message: error.message }));
child.once("exit", (code, signal) => {
  log({ type: code === 0 ? "agent_end" : "agent_error", elapsedMs: Date.now() - startedAt, code, signal });
  revokeCredentialLease(credentialLease);
  process.exitCode = code ?? 1;
});
// Pi RPC installs its stdin reader asynchronously; writing immediately after
// spawn can lose this first command. Match the SDK client's startup guard.
setTimeout(() => {
  if (config.resident) send({ id: "worker-session", type: "new_session" });
  else sendStartupPrompt();
}, 100);
process.once("SIGTERM", () => child.kill("SIGTERM"));
