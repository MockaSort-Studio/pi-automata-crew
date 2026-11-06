// A Crew member's `model` travels straight from start_crew's input into the worker spawn
// config (see startup.mjs and crew-runtime/lib/worker.mjs's `--model` flag). Nothing between
// those two points used to look at the value: a sentinel like "inherit" or an explicit but
// nonexistent model id reached the worker process unexamined, and the worker exited at
// startup with a provider-level "Model ... not found" error -- after the Crew (and its
// namespace, roster, and launch files) had already been spawned. This module makes both
// failure modes a bounded, actionable rejection in prepareCrew, before anything is created.
const MODEL_SENTINELS = new Set(["", "inherit", "default"]);
// Pi's own CLI resolves a bare model id against the catalog only when it is unambiguous
// across providers; a canonical "provider/id" reference is always unambiguous. Mirror that
// here so a valid id a user would type isn't rejected by stricter matching.
function catalogReferences(entry) {
  const refs = [];
  if (typeof entry?.id === "string" && entry.id) refs.push(entry.id);
  if (typeof entry?.provider === "string" && entry.provider && typeof entry?.id === "string" && entry.id)
    refs.push(`${entry.provider}/${entry.id}`);
  return refs;
}
// Returns the Model catalog known to the running Pi (ctx.modelRegistry, as supplied to
// extension tool handlers) or undefined when the caller hasn't wired one in -- a test double,
// or an older host. Validation is skipped, not failed, when the catalog is unavailable: a
// missing catalog is a capability gap, not evidence the model id is wrong.
function availableCatalog(ctx) {
  const registry = ctx?.modelRegistry;
  if (!registry || typeof registry.getAll !== "function") return undefined;
  try {
    const all = registry.getAll();
    return Array.isArray(all) ? all : undefined;
  } catch {
    return undefined;
  }
}
function isKnownModel(reference, catalog) {
  return catalog.some((entry) => catalogReferences(entry).includes(reference));
}
// Validates every model value a Crew launch would spawn with -- the Crew-level default and
// each member's override -- before prepareCrew creates any roster, launch file, or namespace.
// Omitted values (undefined/blank) are left alone: Pi's runtime default applies, same as
// today. Explicit sentinels ("inherit", "default") are rejected outright rather than
// resolved, because resolving them silently would hide a typed mistake behind a changing
// value. Explicit ids are checked against the SDK-visible catalog when one is available.
export function validateModelSelection(models, ctx) {
  const catalog = availableCatalog(ctx);
  for (const model of models) {
    if (typeof model !== "string") continue;
    const trimmed = model.trim();
    if (!trimmed) continue;
    if (MODEL_SENTINELS.has(trimmed.toLowerCase()))
      throw new Error('Omit model to use Pi\'s current default; "inherit" and "default" are not model IDs.');
    if (catalog && !isKnownModel(trimmed, catalog))
      throw new Error(
        `Model "${trimmed}" was not found in Pi's available model catalog. Use a known model id (bare or "provider/id"), or omit model to use Pi's current default.`,
      );
  }
}
