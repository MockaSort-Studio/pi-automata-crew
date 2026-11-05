import crew from "./crew/crew/index.ts";
import runtime from "./crew/crew-runtime/index.ts";

// Crew is one extension. The public Crew layer composes policy and
// orchestration; Crew Runtime owns its worker processes and communication.
export default function crewPackage(pi: any): void {
  crew(pi);
  runtime(pi);
}
