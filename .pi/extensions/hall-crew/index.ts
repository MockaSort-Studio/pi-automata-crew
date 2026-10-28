import crew from "./crew/index.ts";
import runtime from "./crew-runtime/index.ts";

// Hall Crew is one extension. The public Crew layer composes policy and
// orchestration; Crew Runtime owns its worker processes and communication.
export default function hallCrew(pi: any): void {
  crew(pi);
  runtime(pi);
}
