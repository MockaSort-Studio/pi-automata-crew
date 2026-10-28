import { Runtime } from "./runtime.mjs";

const runtimes = new Map();

export function runtimeFor(cwd) {
  if (!runtimes.has(cwd)) runtimes.set(cwd, new Runtime(cwd));
  return runtimes.get(cwd);
}
