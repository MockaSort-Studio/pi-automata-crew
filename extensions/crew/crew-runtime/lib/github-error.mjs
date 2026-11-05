class GithubAdapterError extends Error {
  constructor(message, { cause, status, operation, resource } = {}) {
    super(message, { cause });
    this.name = "GithubAdapterError";
    this.status = status;
    this.operation = operation;
    this.resource = resource;
    this.transient = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

function statusOf(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const match = `${error?.stderr ?? ""}\n${error?.message ?? ""}`.match(
    /\bHTTP\s+(\d{3})\b|\bstatus(?:Code)?[=: ]+(\d{3})\b/i,
  );
  return match ? Number(match[1] ?? match[2]) : undefined;
}

export function githubError(error, operation, resource) {
  if (error instanceof GithubAdapterError) return error;
  const status = statusOf(error);
  const detail = error?.stderr?.trim() || error?.message || "unknown GitHub failure";
  return new GithubAdapterError(
    `GitHub ${operation} failed for ${resource}${status ? ` (HTTP ${status})` : ""}: ${detail}`,
    { cause: error, status, operation, resource },
  );
}

export async function githubCommand(exec, args, operation, resource) {
  try {
    return await exec("gh", args);
  } catch (error) {
    throw githubError(error, operation, resource);
  }
}

export async function githubJson(exec, args, operation, resource) {
  const result = await githubCommand(exec, args, operation, resource);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw githubError(error, operation, resource);
  }
}
