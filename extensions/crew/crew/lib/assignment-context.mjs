const fields = ["inputs", "deliverTo", "authority", "acceptanceCriteria"];

export function assignmentContext(member) {
  const assignment = Object.fromEntries(
    fields.filter((field) => member[field] !== undefined).map((field) => [field, member[field]]),
  );
  return Object.keys(assignment).length ? `\n\n## ASSIGNMENT CONTEXT\n${JSON.stringify(assignment)}` : "";
}
