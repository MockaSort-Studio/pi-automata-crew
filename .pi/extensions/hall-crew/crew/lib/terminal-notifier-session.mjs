// Binds the read-only Runtime terminal notifier to one Pi session.
export function registerTerminalNotifierSession(pi, runtimeFor) {
  let detach;
  const attach = (ctx) => {
    detach?.();
    const runtime = runtimeFor(ctx.cwd);
    const send = (message, options) => pi.sendMessage(message, options);
    const detachers = [runtime.attachTerminalNotifier(send), runtime.attachMainDelivery(send)];
    detach = () => detachers.forEach((fn) => fn());
  };
  pi.on("session_start", (_event, ctx) => attach(ctx));
  pi.on("session_shutdown", () => {
    detach?.();
    detach = undefined;
  });
  return attach;
}
