import { canonicalHandle } from "./discussion-templates.mjs";

export function assertActorOwnsSender(roster, from, environment = process.env) {
  const actorId = environment.PI_SDK_ACTOR_ID?.trim();
  if (!actorId) return;
  const name = canonicalHandle(from);
  const sender = [roster.lead, ...(roster.members || [])].filter(Boolean).find((member) => member.name === name);
  if (!sender || sender.actorId !== actorId) {
    throw new Error("Crew sender does not match the invoking SDK actor.");
  }
}
