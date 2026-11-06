import { toGuestPath } from "./gondolin-worker-paths.mjs";

export function bashOperations(vm, cwd) {
  return {
    async exec(command, commandCwd, { onData, signal }) {
      if (signal?.aborted) throw new Error("aborted");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const process = vm.exec(["/bin/sh", "-lc", command], {
          cwd: toGuestPath(cwd, commandCwd),
          signal: controller.signal,
          stderr: "pipe",
          stdout: "pipe",
        });
        for await (const chunk of process.output()) onData(chunk.data);
        return { exitCode: (await process).exitCode };
      } catch (error) {
        if (signal?.aborted) throw new Error("aborted");
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
