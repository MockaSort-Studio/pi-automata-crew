import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { skillFromCommand, skillFromRead } from "./skill-trace.mjs";

const ENTRY = "skill-used";

// Shows a one-line card in the transcript whenever a skill is used. Entries are not sent to the model.
export function registerSkillTrace(pi: ExtensionAPI) {
  pi.registerEntryRenderer<{ skill: string; via: string }>(ENTRY, (entry, { expanded }, theme) => {
    const data = entry.data ?? { skill: "unknown", via: "read" };
    const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
    box.addChild(
      new Text(
        `${theme.fg("accent", "◆ skill")} ${theme.bold(data.skill)} ${theme.fg("dim", data.via === "command" ? "(/skill)" : "(loaded)")}`,
        0,
        0,
      ),
    );
    if (expanded) box.addChild(new Text(theme.fg("dim", `via ${data.via}`), 0, 0));
    return box;
  });

  pi.on("input", (event) => {
    const skill = skillFromCommand(event.text);
    if (skill) pi.appendEntry(ENTRY, { skill, via: "command" });
    return { action: "continue" };
  });

  pi.on("tool_result", (event) => {
    const skill = skillFromRead(event.toolName, event.input);
    if (skill && !event.isError) pi.appendEntry(ENTRY, { skill, via: "read" });
  });
}
