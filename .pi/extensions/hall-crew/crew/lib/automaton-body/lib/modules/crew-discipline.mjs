import { readFileSync } from "node:fs";
const FILE = new URL("../../../../prompts/crew-discipline.md", import.meta.url);
export function crewDisciplineModule() {
  return { instructions: readFileSync(FILE, "utf8").trim() };
}
