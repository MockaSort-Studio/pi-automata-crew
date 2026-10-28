import { spawn } from "node:child_process";

// Comm and Lifecycle are each a child server that announces its port as its first stdout line.
export async function startServer(script, config) {
  const child = spawn(process.execPath, [script, JSON.stringify(config)], { stdio: ["ignore", "pipe", "ignore"] });
  const line = await new Promise((resolve, reject) => {
    child.stdout.once("data", (data) => resolve(String(data)));
    child.once("error", reject);
  });
  return { child, info: JSON.parse(line) };
}

export async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {}
  if (await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]))
    return;
  try {
    process.kill(child.pid, "SIGKILL");
  } catch {}
  await exited;
}
