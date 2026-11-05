// A kickoff is a non-turn-triggering Crew manifest. It establishes the shared
// directory and static plan shape; individual work arrives later as a directed
// Comm task delivery.
export const kickoffPayload = (runId, topic, members) => ({
  kind: "kickoff",
  phase: "manifest",
  body: "Crew manifest: use the directory for targeted coordination. Await a directed task before beginning work.",
  members: members.map(({ handle, role }) => ({ handle, role })),
  plan: members.map(({ handle, dependsOn }) => ({ to: handle, dependsOn: dependsOn ?? [] })),
  runId,
  topic,
});
