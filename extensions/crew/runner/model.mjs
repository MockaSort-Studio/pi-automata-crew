// Resolves a model reference against Pi's own catalog before any VM starts (#49). Pi's `--model` accepts
// an exact id, `provider/id`, or a fuzzy match; the runner only accepts references it can resolve exactly,
// so a launch never starts with a model that cannot run.
const SENTINELS = new Set(["", "inherit", "default"]);

export function resolveModel(modelRuntime, reference) {
  const value = String(reference ?? "").trim();
  if (SENTINELS.has(value.toLowerCase()))
    throw new Error('Name a model as "provider/id"; "inherit" and "default" are not model IDs.');
  const slash = value.indexOf("/");
  if (slash > 0) {
    const model = modelRuntime.getModel(value.slice(0, slash), value.slice(slash + 1));
    if (model) return model;
  } else {
    const matches = modelRuntime.getModels().filter((candidate) => candidate.id === value);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Model "${value}" is offered by several providers; use "provider/id".`);
  }
  throw new Error(`Model "${value}" was not found in Pi's model catalog.`);
}
