// The Lead hands out the plan's work. The broker validates the target against the registered
// plan, so a Lead can neither invent an assignment nor skip a prerequisite: it sends the
// member's planned task (plus an optional short note), only once, and only when every
// prerequisite is complete. Returns the recipient and payload, or throws why it may not.
export function planAssignment({ from, namespace, handle, note, nodes, assigned }) {
  const node = nodes.find((item) => item.handle === handle);
  if (!node) throw new Error(`Unknown Crew member: ${handle}`);
  const leadHandle = from.slice(`${namespace}-`.length);
  if (handle === leadHandle) throw new Error("The Lead cannot assign work to itself");
  if (assigned.has(`${namespace}/${handle}`)) throw new Error(`${handle} has already been assigned`);
  if (["complete", "blocked", "failed"].includes(node.status)) throw new Error(`${handle} is already ${node.status}`);
  const unmet = node.dependsOn.filter((name) => nodes.find((item) => item.handle === name)?.status !== "complete");
  if (unmet.length) throw new Error(`${handle} must wait for ${unmet.join(", ")} to complete`);
  return {
    to: `${namespace}-${handle}`,
    payload: {
      kind: "task",
      phase: "assignment",
      runId: namespace.replace(/^crew-/, ""),
      task: node.task,
      prerequisites: node.dependsOn,
      reportTo: leadHandle,
      ...(note ? { note: String(note).slice(0, 2000) } : {}),
    },
  };
}
