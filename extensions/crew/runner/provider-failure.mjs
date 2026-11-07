// Never persist or report a provider's raw error: it can contain credentials, request ids or prompt text.
// Only a fixed category is derived from it.
export function providerFailureCategory(message) {
  if (message?.stopReason !== "error") return undefined;
  const text = String(message.errorMessage ?? "");
  if (/\b(?:401|403)\b|unauthorized|authentication/i.test(text)) return "authentication_or_permission";
  if (/\b429\b|rate.limit|quota/i.test(text)) return "rate_limit_or_quota";
  if (/\b(?:500|502|503|504)\b|overloaded/i.test(text)) return "provider_unavailable";
  if (/\b404\b|model.*not.found/i.test(text)) return "model_not_found";
  return "provider_error";
}
