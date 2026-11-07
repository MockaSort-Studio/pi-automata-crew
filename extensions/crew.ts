import crew from "./crew/crew/index.ts";

// Crew is one extension. Crew assembles roles, personas and tool grants; the crew host (extensions/crew/runner)
// runs each member as a Pi session whose tools execute in its own isolated VM. The earlier runtime
// (extensions/crew/crew-runtime: Comm, Lifecycle, resident workers) is kept in the repository but not loaded.
export default function crewPackage(pi: any): void {
  crew(pi);
}
