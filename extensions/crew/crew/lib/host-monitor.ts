import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildAutomataTab } from "./monitor-dashboard.mjs";
import { registerCrewDashboardCommand } from "./monitor-dashboard-command.mjs";
import { wrapDashboardChrome } from "./monitor-dashboard-chrome.mjs";
import { pickActiveCrew } from "./monitor-dashboard-picker.mjs";
import { buildFooterWidgetFactory } from "./monitor-footer-widget.mjs";
import { crewView, isActive, pickerItem, planRows } from "./crew-view.mjs";

const WIDGET = "crew-monitor";
const POLL_MS = 1000;
const MAX_LINES = 5;

// Main's footer and dashboard for crews running on the crew host. The host answers `status`; the existing
// footer and dashboard renderers draw it. Polling only happens while Pi shows a TUI and a crew exists, and
// never starts the host.
export function registerHostMonitor(pi: ExtensionAPI, host: (ctx: ExtensionContext) => any) {
  let ctx: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  const latest = new Map<string, any[]>();

  const clear = () => ctx?.ui.setWidget(WIDGET, undefined);

  function draw() {
    if (!ctx) return;
    const lines = [...latest.entries()]
      .filter(([, members]) => isActive(members))
      .slice(-MAX_LINES)
      .map(([runId, members]) => crewView({ runId, members }).line);
    if (lines.length) ctx.ui.setWidget(WIDGET, buildFooterWidgetFactory(lines), { placement: "aboveEditor" });
    else clear();
  }

  async function poll() {
    if (!ctx || polling) return;
    const crew = host(ctx);
    const client = crew.peek();
    for (const runId of [...latest.keys()]) if (!crew.runs().includes(runId)) latest.delete(runId);
    if (!client || !crew.runs().length) return draw();
    polling = true;
    try {
      await Promise.all(
        crew.runs().map(async (runId: string) => {
          try {
            latest.set(runId, (await client.request("status", { runId })).members);
          } catch {}
        }),
      );
    } finally {
      polling = false;
    }
    draw();
  }

  const start = (sessionCtx: ExtensionContext) => {
    ctx = sessionCtx;
    if (ctx.mode !== "tui") return;
    timer ??= setInterval(poll, POLL_MS);
    void poll();
  };
  pi.on("session_start", (_event, sessionCtx) => start(sessionCtx));
  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    clear();
    ctx = undefined;
  });

  const known = () => [...latest.entries()].map(([runId, members]) => ({ runId, members }));
  const dataFor = (runId?: string) => {
    const entry = known().find(
      (item) =>
        item.runId ===
        (runId ??
          known()
            .filter((k) => isActive(k.members))
            .at(-1)?.runId ??
          known().at(-1)?.runId),
    );
    if (!entry || !ctx) return { automataRows: [], planRows: [] };
    return {
      automataRows: buildAutomataTab(crewView(entry).snapshot),
      planRows: planRows({ plan: host(ctx).plan(entry.runId), members: entry.members }),
    };
  };
  registerCrewDashboardCommand(
    pi,
    dataFor,
    wrapDashboardChrome,
    () =>
      known()
        .filter((entry) => isActive(entry.members))
        .map((entry) => ({ path: entry.runId, item: pickerItem(entry) })),
    pickActiveCrew,
  );

  // Called right after a launch so the footer appears without waiting for the next poll.
  return { activate: (sessionCtx: ExtensionContext) => start(sessionCtx) };
}
