import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCleanMessage, canonicalHandle } from "./discussion-templates.mjs";
import { assertActorOwnsSender } from "./caller.mjs";
const gh = (args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
function ghWithBody(args, body) {
  const dir = mkdtempSync(join(tmpdir(), "crew-"));
  const file = join(dir, "body.txt");
  writeFileSync(file, body, "utf8");
  try {
    return gh([...args, "-F", `body=@${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function discussionId(owner, repo, number) {
  const query = "query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){id}}}";
  return gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `o=${owner}`,
    "-f",
    `r=${repo}`,
    "-F",
    `n=${number}`,
    "--jq",
    ".data.repository.discussion.id",
  ]);
}
export const readRoster = (path) => JSON.parse(readFileSync(path, "utf8"));
export const writeRoster = (path, roster) => writeFileSync(path, JSON.stringify(roster, null, 2), "utf8");
const assertLead = (roster, from) => {
  if (roster.lead?.name !== canonicalHandle(from)) throw new Error("Only the Crew Lead may perform this operation.");
  assertActorOwnsSender(roster, from);
};
export function discussionState(roster) {
  const query =
    "query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){closed closedAt}}}";
  return JSON.parse(
    gh([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `o=${roster.owner}`,
      "-f",
      `r=${roster.repo}`,
      "-F",
      `n=${roster.discussionNumber}`,
      "--jq",
      ".data.repository.discussion",
    ]),
  );
}
export function resolveRecipient(roster, value) {
  const name = canonicalHandle(value);
  const recipients = [roster.lead, ...roster.members].filter(Boolean);
  const member = recipients.find((item) => item.name === name);
  if (!member)
    throw new Error(
      `Crew member \"${name}\" not found. Use one of: ${recipients.map((item) => `@${item.name}`).join(", ")}`,
    );
  return member;
}
export function registerMembers(roster, from, members) {
  if (roster.status !== "started" || !roster.discussionNumber)
    throw new Error("Members may be registered only on an active Crew with a canonical Discussion.");
  assertLead(roster, from);
  const next = [...(roster.members || [])];
  for (const candidate of members) {
    const member = {
      name: canonicalHandle(candidate.name),
      actorId: candidate.actorId?.trim(),
      role: candidate.role?.trim(),
    };
    if (!member.actorId || !member.role) throw new Error("Crew members require actorId and role.");
    const byName = next.find((item) => item.name === member.name);
    const byActor = next.find((item) => item.actorId === member.actorId);
    if (byName && byName.actorId !== member.actorId)
      throw new Error(`Crew member \"${member.name}\" is already registered to another actor.`);
    if (byActor && byActor.name !== member.name)
      throw new Error(`Actor \"${member.actorId}\" is already registered under another name.`);
    if (!byName) next.push(member);
  }
  return { ...roster, members: next };
}
export function unregisterMembers(roster, from, removals) {
  assertLead(roster, from);
  if (!removals.every((item) => item?.removed === true && item.actorId?.trim()))
    throw new Error("Crew unregister requires verified { actorId, removed:true } results.");
  const ids = new Set(removals.map((item) => item.actorId.trim()));
  return {
    ...roster,
    members: (roster.members || []).filter((member) => !ids.has(member.actorId)),
    cleanup: [...(roster.cleanup || []), ...[...ids].map((actorId) => ({ actorId, outcome: "removed" }))],
  };
}
export function reconcileAbsentMembers(roster, from, actorIds, observedAt) {
  assertLead(roster, from);
  if (roster.status !== "closing") throw new Error("Absent actors may be reconciled only while closing.");
  const ids = new Set(actorIds.map((id) => id.trim()));
  if (!observedAt?.trim() || !ids.size || ids.has(""))
    throw new Error("Absence reconciliation requires actor IDs and observedAt.");
  const unknown = [...ids].find((id) => !(roster.members || []).some((member) => member.actorId === id));
  if (unknown) throw new Error(`Cannot reconcile unrostered actor \"${unknown}\".`);
  return {
    ...roster,
    members: (roster.members || []).filter((member) => !ids.has(member.actorId)),
    cleanup: [...(roster.cleanup || []), ...[...ids].map((actorId) => ({ actorId, outcome: "absent", observedAt }))],
  };
}
export function resolveReplyTarget(roster, replyToId) {
  const request = (roster.pendingHumanRequests || []).find((item) => item.id === replyToId);
  return request?.threadRootId || request?.replyToId || replyToId;
}
export function beginClose(roster, from, closedAt, github) {
  assertLead(roster, from);
  if (roster.completionMode === "human-gated" && !github?.closed)
    throw new Error("Human-gated closure requires GitHub-confirmed Discussion closure.");
  if (roster.completionMode !== "human-gated" && !roster.finalCommentId)
    throw new Error("Unattended Crews must publish acceptance with crew_close before closing.");
  if (roster.status === "done" || roster.status === "closing") return roster;
  if (roster.status !== "started") throw new Error("Only an active Crew may begin closure.");
  return { ...roster, status: "closing", discussionClosed: true, discussionClosedAt: github?.closedAt || closedAt };
}
export function finishClose(roster, from) {
  assertLead(roster, from);
  if (roster.status === "done") return roster;
  if (roster.status !== "closing" || (roster.members || []).length)
    throw new Error("All specialists must be unregistered before closure.");
  return { ...roster, status: "done" };
}
export function assertSubstantive(message) {
  const text = message
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\S+/g, "")
    .replace(/^#+\s*/gm, "")
    .trim();
  if (text.length < 8)
    throw new Error(
      "Crew messages must contain a substantive instruction, question, or finding; a URL alone is not enough.",
    );
}
export function signedBody(roster, from, message, signature) {
  if (roster.status !== "started") throw new Error("Crew Discussion mutations require an active Crew.");
  const senders = [roster.lead, ...roster.members].filter(Boolean);
  const sender = canonicalHandle(from);
  if (!senders.some((member) => member.name === sender)) throw new Error(`Unknown Crew sender \"${sender}\"`);
  assertActorOwnsSender(roster, sender);
  assertCleanMessage(message);
  assertSubstantive(message);
  if (!signature?.trim() || signature.trim().length < 6)
    throw new Error("Crew posts require the sender's completed persona signature.");
  return `${message}\n\n---\n@${sender}\n${signature.trim()}`;
}
export function markDiscussionClosed(roster, closed) {
  if (!closed?.closed) throw new Error("GitHub did not report the Discussion as closed.");
  return {
    ...roster,
    status: (roster.members || []).length ? "closing" : "done",
    discussionClosed: true,
    discussionClosedAt: closed.closedAt,
  };
}
export function postComment(roster, body, replyToId) {
  const id = discussionId(roster.owner, roster.repo, roster.discussionNumber);
  const reply = replyToId ? ",replyToId:$reply" : "";
  const variable = replyToId ? ",$reply:ID!" : "";
  const mutation = `mutation($id:ID!,$body:String!${variable}){addDiscussionComment(input:{discussionId:$id,body:$body${reply}}){comment{id url}}}`;
  const args = ["api", "graphql", "-f", `query=${mutation}`, "-f", `id=${id}`];
  if (replyToId) args.push("-f", `reply=${replyToId}`);
  return JSON.parse(ghWithBody([...args, "--jq", ".data.addDiscussionComment.comment"], body));
}
export function closeDiscussion(roster) {
  const id = discussionId(roster.owner, roster.repo, roster.discussionNumber);
  const mutation = "mutation($id:ID!){closeDiscussion(input:{discussionId:$id}){discussion{url closed closedAt}}}";
  return JSON.parse(
    gh(["api", "graphql", "-f", `query=${mutation}`, "-f", `id=${id}`, "--jq", ".data.closeDiscussion.discussion"]),
  );
}
