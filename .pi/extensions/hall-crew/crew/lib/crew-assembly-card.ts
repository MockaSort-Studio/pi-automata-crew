import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

export const CREW_ASSEMBLED_ENTRY = "crew-assembled";
type Member = { specialist: string; role: string; handle: string; model: string; task: string; dependsOn: string[] };
type Card = { runId: string; environment: string; members: Member[] };

const clipped = (value: string, length: number) => (value.length > length ? `${value.slice(0, length - 1)}…` : value);
const pad = (value: string, length: number) => clipped(value, length).padEnd(length);

// A session entry is durable and rendered by the TUI, but is excluded from model context.
export function registerCrewAssemblyCard(pi: ExtensionAPI) {
  pi.registerEntryRenderer<Card>(CREW_ASSEMBLED_ENTRY, (entry, { expanded }, theme) => {
    const data = entry.data ?? { runId: "unknown", environment: "auto", members: [] };
    const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
    const count = data.members.length;
    box.addChild(
      new Text(
        `${theme.fg("success", "◆ Crew assembled")} ${theme.fg("dim", `${count} member${count === 1 ? "" : "s"} · ${data.environment}`)}`,
        0,
        0,
      ),
    );
    box.addChild(
      new Text(theme.fg("dim", "specialist       role        model          task                         deps"), 0, 0),
    );
    for (const member of data.members) {
      const dependencies = member.dependsOn.length ? member.dependsOn.join(", ") : "—";
      box.addChild(
        new Text(
          `${pad(member.specialist, 16)} ${pad(member.role, 11)} ${pad(member.model, 14)} ${pad(member.task, 28)} ${clipped(dependencies, 18)}`,
          0,
          0,
        ),
      );
      if (expanded) {
        box.addChild(new Text(theme.fg("dim", `  ${member.handle}: ${member.task}; depends on ${dependencies}`), 0, 0));
      }
    }
    return box;
  });
}
