import { toGuestPath } from "./gondolin-worker-paths.mjs";

export function bashOperations(vm, cwd) {
  return {
    async exec(command, commandCwd, { onData, signal, timeout }) {
      if (signal?.aborted) throw new Error("aborted");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      let timedOut = false;
      const timer =
        timeout && timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeout * 1000)
          : undefined;
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
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
