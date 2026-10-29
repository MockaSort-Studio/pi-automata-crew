const task = (value) => String(value || "").trim() || "—";

// Keep display data deliberately small: no grants, credentials, paths, or runtime ids beyond a handle.
export function assemblyCardData(prepared, input) {
  return {
    runId: prepared.runId,
    environment: input.environment?.microvm ?? "auto",
    members: prepared.agents.map((actor, index) => {
      const member = input.members[index];
      return {
        specialist: actor.name,
        role: actor.role,
        handle: actor.handle,
        model: member.model ?? input.model ?? "default",
        task: task(member.task),
        dependsOn: member.dependsOn ?? [],
      };
    }),
  };
}
