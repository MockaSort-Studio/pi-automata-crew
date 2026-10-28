const dispatchTrigger = /(?:^|\s)dispatch(?:\s|$)/iu;

const dispatchContract = `

---
## CREW DISPATCH PROTOCOL
This request is a Crew dispatch. Apply this protocol before responding:
1. Form one bounded Crew plan: objective, selected canonical roles, per-member assignments, dependencies, models, and acceptance criteria.
2. Dispatch only through \`start_crew\`. Do not use standalone SDK-agent paths.
3. A successful \`start_crew\` call launches the Crew and broadcasts one non-turn-triggering \`kind: "kickoff"\` manifest to registered Crew recipients. It does not assign specialist work; use Main dispatch controls for directed tasks. Do not create a second kickoff.
4. Report launch truthfully from the tool result. The existing Crew TUI and lifecycle own worker progress and completion; do not recreate them in prose.
5. Preserve worker outputs before cleanup or retry.
`;

export function isCrewDispatchRequest(text) {
  return dispatchTrigger.test(text.trim());
}

export function installCrewDispatchArming(pi) {
  pi.on("input", (event) => {
    if (event.source === "extension" || !event.text || !isCrewDispatchRequest(event.text))
      return { action: "continue" };
    return { action: "transform", text: `${event.text}${dispatchContract}` };
  });
}
