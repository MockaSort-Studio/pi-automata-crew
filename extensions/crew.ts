import crew from "./crew/crew/index.ts";

// Crew is one extension. Crew assembles roles, personas and tool grants; the crew host (extensions/crew/runner)
// runs each member as a Pi session whose tools execute in its own isolated VM.
export default function crewPackage(pi: any): void {
  crew(pi);
}
