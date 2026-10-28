import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveModelWindow } from "./model-window.mjs";
import { summarizeWorkerEvents } from "./worker-metrics.mjs";
import { syncWorkingTree } from "./worktree-sync.mjs";
import { preflightWorkerSandbox } from "../../env-runtime/lib/sandbox-preflight.mjs";

const exec = promisify(execFile);
const GIT_TIMEOUT = 30_000;

// A worker that exits while "stopping" was ended by remove(), not by completing: "removed",
// whatever its exit code or signal.
export const terminalStatus = (previousStatus, code) =>
  previousStatus === "stopping" ? "removed" : code === 0 ? "completed" : "failed";
const runGit = (cwd, args) =>
  exec("git", args, { cwd, timeout: GIT_TIMEOUT, killSignal: "SIGKILL", maxBuffer: 64 * 1024 });
const waitForExit = (child, ms) =>
  new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

export class LifecycleController {
  #agents = new Map();
  // Metrics survive remove(): once events.jsonl and the worktree are deleted, this is the only
  // place a worker's final telemetry is still readable.
  #retainedMetrics = new Map();
  constructor({ cwd, workerModule, preflight = preflightWorkerSandbox }) {
    this.cwd = cwd;
    this.workerModule = workerModule;
    this.preflight = preflight;
  }
  async spawn(config) {
    await this.preflight(config);
    const id = config.actorId ?? randomUUID();
    if (this.#agents.has(id)) throw new Error(`SDK actor already exists: ${id}`);
    const root = join(this.cwd, ".pi", "runtime", "runs", id),
      worktree = join(root, "worktree"),
      configFile = join(root, "worker.json"),
      logFile = join(root, "events.jsonl");
    let worktreeAdded = false,
      child;
    try {
      await mkdir(root, { recursive: true });
      await runGit(this.cwd, ["worktree", "add", "--detach", worktree, "HEAD"]);
      worktreeAdded = true;
      await syncWorkingTree(this.cwd, root, worktree);
      await writeFile(
        configFile,
        JSON.stringify({
          cwd: worktree,
          extensionCwd: this.cwd,
          task: config.task,
          model: config.model,
          thinking: config.thinking,
          tools: config.tools,
          commTools: config.commTools,
          extensionPaths: config.extensionPaths,
          comm: config.comm,
          delivery: config.delivery,
          resident: config.resident,
          initialTurn: config.initialTurn,
          crewMembers: config.crewMembers,
          crewLead: config.crewLead,
          namespace: config.namespace,
          sandbox: config.sandbox,
          armory: config.armory,
          logFile,
        }),
      );
      // Never grant a worker host-root discovery: it owns only its worktree
      // under .pi/runtime/runs/<id>/worktree and must not be able to resolve
      // or mutate the host repo's .pi/runtime state. Strip any ambient
      // PI_CREW_ROOT explicitly, in case this process itself is a worker
      // that inherited one, instead of trusting it to be absent.
      const { PI_CREW_ROOT: _hostCrewRoot, ...hostEnv } = process.env;
      child = (await import("node:child_process")).spawn(process.execPath, [this.workerModule, configFile], {
        cwd: worktree,
        detached: true,
        stdio: "ignore",
        env: { ...hostEnv, PI_SDK_ACTOR_ID: id },
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      // Keep the child handle referenced: Lifecycle owns worker cleanup and
      // must remain alive long enough to observe a natural worker exit.
      const agent = {
        id,
        name: config.name,
        pid: child.pid,
        worktree,
        status: "running",
        model: config.model,
        namespace: config.namespace,
      };
      Object.defineProperty(agent, "child", { value: child });
      this.#agents.set(id, agent);
      const recordExit = (code, signal) => {
        agent.status = terminalStatus(agent.status, code);
        agent.exitCode = code;
        agent.signal = signal;
      };
      child.once("exit", recordExit);
      // A short-lived worker can exit between its spawn event and listener
      // registration. Preserve its terminal state instead of leaving it live.
      if (child.exitCode !== null) recordExit(child.exitCode, child.signal);
      return agent;
    } catch (error) {
      if (child?.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      if (worktreeAdded) await runGit(this.cwd, ["worktree", "remove", "--force", worktree]).catch(() => {});
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  async list() {
    return [...this.#agents.values()];
  }
  async #readEvents(id) {
    const path = join(this.cwd, ".pi", "runtime", "runs", id, "events.jsonl");
    return readFile(path, "utf8")
      .then((text) =>
        text
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      )
      .catch(() => []);
  }
  async #captureMetrics(agent) {
    const events = await this.#readEvents(agent.id);
    const metrics = summarizeWorkerEvents(events, { modelWindow: resolveModelWindow(agent.model) });
    const snapshot = { name: agent.name, model: agent.model, events: events.length, metrics };
    this.#retainedMetrics.set(agent.id, snapshot);
    return snapshot;
  }
  async inspect(id) {
    const agent = this.#agents.get(id);
    if (!agent) {
      const retained = this.#retainedMetrics.get(id);
      if (!retained) return { id, found: false };
      return { id, found: true, retained: true, status: "removed", ...retained };
    }
    const snapshot = await this.#captureMetrics(agent);
    return { ...agent, found: true, ...snapshot };
  }
  async remove(id) {
    const agent = this.#agents.get(id);
    if (!agent) return { id, removed: false };
    agent.status = "stopping";
    try {
      process.kill(-agent.pid, "SIGTERM");
    } catch {}
    if (!(await waitForExit(agent.child, 5_000)))
      try {
        process.kill(-agent.pid, "SIGKILL");
      } catch {}
    // Snapshot telemetry before the run directory is wiped: this is the last
    // moment events.jsonl exists to summarize.
    await this.#captureMetrics(agent);
    await runGit(this.cwd, ["worktree", "remove", "--force", agent.worktree]);
    await rm(join(this.cwd, ".pi", "runtime", "runs", id), { recursive: true, force: true });
    // Terminalize before the record disappears so any observer racing this
    // cleanup (list/inspect) never sees a stale "stopping" or misdiagnosed
    // "failed" state for a worker that was removed on purpose.
    agent.status = "removed";
    this.#agents.delete(id);
    return { id, removed: true, status: agent.status };
  }
  async shutdown() {
    const agents = await this.list();
    return Promise.allSettled(agents.map((agent) => this.remove(agent.id)));
  }
}
