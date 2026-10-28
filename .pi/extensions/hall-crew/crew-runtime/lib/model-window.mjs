// Known provider context window sizes (tokens), keyed by the model id a
// worker is spawned with. Deliberately conservative and small: an unknown
// model id resolves to null rather than a guessed number, so metrics stay
// honest about what they don't know.
const KNOWN_WINDOWS = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-6": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
  "gpt-5.1": 400_000,
  "gpt-5.1-codex": 400_000,
  "gemini-3-pro": 1_000_000,
};

// Model ids are sometimes namespaced as "provider/model-id"; match on the
// trailing segment so both forms resolve the same way.
export function resolveModelWindow(modelId) {
  if (typeof modelId !== "string" || modelId.length === 0) return null;
  const key = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  return KNOWN_WINDOWS[key] ?? null;
}
