// A server that outlives the Main session that started it would run forever. Poll the owner's
// PID (signal 0 sends nothing) and call `onGone` once it no longer exists.
export function watchParent(hostPid, onGone, intervalMs = 1_000) {
  if (!hostPid) return;
  const timer = setInterval(() => {
    try {
      process.kill(hostPid, 0);
    } catch {
      onGone();
    }
  }, intervalMs);
  timer.unref();
}
