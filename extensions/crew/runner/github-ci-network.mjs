// Reject unexpected headers before Gondolin substitutes any placeholder. Requiring
// the placeholder also rejects redirects, whose next hop contains the real token.
export function githubCiHeadersAllowed(headers, placeholder) {
  if (!placeholder || headers.get("authorization") !== `Bearer ${placeholder}`) return false;
  const allowed = new Set(["authorization", "accept", "user-agent", "x-github-api-version", "host"]);
  for (const [name, value] of headers) {
    if (!allowed.has(name) || (name !== "authorization" && value.includes(placeholder))) return false;
    if (name === "host" && value !== "api.github.com") return false;
  }
  return true;
}

// Only metadata endpoints corresponding to the member's explicit Armory grants.
export function githubCiRequestAllowed(request, { repo, operations }) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (
    request.method !== "GET" ||
    url.protocol !== "https:" ||
    url.hostname !== "api.github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    return false;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || url.pathname.includes("%")) return false;
  const prefix = `/repos/${repo}/actions`;
  if (!url.pathname.startsWith(prefix + "/")) return false;
  const path = url.pathname.slice(prefix.length);
  const list = path === "/runs";
  const view =
    /^\/runs\/[1-9][0-9]*$/.test(path) ||
    /^\/runs\/[1-9][0-9]*\/jobs$/.test(path) ||
    /^\/jobs\/[1-9][0-9]*$/.test(path);
  if (
    !(list && operations.includes("github_workflow_runs_list")) &&
    !(view && operations.includes("github_workflow_run_view"))
  )
    return false;
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!["page", "per_page"].includes(key) || seen.has(key) || !/^[1-9][0-9]*$/.test(value)) return false;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n > (key === "per_page" ? 100 : 1000)) return false;
    seen.add(key);
  }
  return true;
}
