// A member that opened a pull request is not done until its CI is green. The runner polls the PR's current checks;
// a red result becomes a message for the member's own session, with the failing checks and log tails.
const PULL_URL = /\/pull\/(\d+)(?:[/?#]|$)/;
const MAX_FOLLOW_UP_CHARS = 8000;
const MAX_LOG_CHARS = 2500;

export const pullNumberOf = (url) => Number(PULL_URL.exec(String(url ?? ""))?.[1]) || undefined;

// A green CI means nothing if the change weakened the checks. These paths define them (CI workflows, formatter and
// linter ignore lists and configs, test-runner configs, and package.json, whose scripts CI runs, such as
// `format:check`); a pull request that touches one is reported to Main even when CI is green. It is deliberately
// generic and short: a reviewer still reads the diff.
const GATE_FILES = [
  /(^|\/)package\.json$/,
  /^\.github\/(workflows|actions)\//,
  /(^|\/)\.(prettier|eslint|stylelint|markdownlint)ignore$/,
  /(^|\/)\.(prettier|eslint|stylelint|markdownlint)rc[^/]*$/,
  /(^|\/)(eslint|prettier|stylelint)\.config\.[^/]+$/,
  /(^|\/)(jest|vitest|playwright|karma)\.config\.[^/]+$/,
];
export const gateFilesOf = (files = []) =>
  files
    .map((file) => String(file?.filename ?? file?.path ?? ""))
    .filter((name) => GATE_FILES.some((re) => re.test(name)));

const bounded = (text, max) => (text.length <= max ? text : `[...]\n${text.slice(-max)}`);

// What the member is told when CI is red. Bounded: a log can be enormous and only its tail matters.
export function ciFollowUp({ pullNumber, sha, failures = [] }) {
  const header = `CI is red on your pull request #${pullNumber}${sha ? ` (commit ${sha.slice(0, 7)})` : ""}.`;
  const blocks = failures.map(
    ({ name, url, logTail }) =>
      `### ${name}${url ? ` (${url})` : ""}\n${logTail ? bounded(String(logTail), MAX_LOG_CHARS) : "(no log available)"}`,
  );
  const footer =
    "Find the cause and fix it in your workspace, commit and push to the same branch, then end your turn. " +
    "Fix the cause: do not disable, skip, ignore or exclude checks to make them pass (changes to CI or tool " +
    "configuration are reported to Main). CI is checked again automatically. If you cannot fix it, call " +
    "request_input and say why.";
  return bounded([header, ...blocks, footer].join("\n\n"), MAX_FOLLOW_UP_CHARS);
}

// Normalize the two rollup entry types into the runner's compact check representation.
export function summarizeChecks(rollup) {
  const checks = rollup.map((entry) => {
    const isRun = entry.__typename === "CheckRun";
    const conclusion = String(isRun ? (entry.conclusion ?? "") : (entry.state ?? "")).toLowerCase();
    const pending = isRun ? entry.status !== "COMPLETED" : conclusion === "pending" || conclusion === "expected";
    return {
      name: isRun ? [entry.workflowName, entry.name].filter(Boolean).join(" / ") : entry.context,
      conclusion,
      url: isRun ? entry.detailsUrl : entry.targetUrl,
      pending,
      passed: isRun ? ["success", "neutral", "skipped"].includes(conclusion) : conclusion === "success",
    };
  });
  const failures = checks.filter((check) => !check.pending && !check.passed);
  return {
    state: !checks.length
      ? "none"
      : failures.length
        ? "failure"
        : checks.some((c) => c.pending)
          ? "pending"
          : "success",
    checks,
    failures,
  };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

// GitHub points the blob URL of a REMOVED file at the base commit, not at the head, so only files that exist on the
// head can identify it. A list with no such file (empty, or only deletions) cannot identify the head: fail closed.
const headOf = (files) => {
  const present = files.filter((file) => file.status !== "removed");
  const heads = new Set(
    present.map((file) => /\/blob\/([a-f\d]{40})\//i.exec(file.blob_url ?? "")?.[1]?.toLowerCase()),
  );
  return present.length && heads.size === 1 ? [...heads][0] : undefined;
};

export async function verifyPullRequest({
  ops,
  repository,
  evidence,
  signal,
  pollIntervalMs = 15000,
  noChecksGraceMs = 90000,
}) {
  const pullNumber = pullNumberOf(evidence?.pullRequest);
  if (!pullNumber) return null;
  const sha = evidence?.pushed?.commit;
  const input = { repo: repository.repo, pullNumber };
  const call = (name, args = input) => {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
    return abortable(
      Promise.resolve().then(() => ops.call(name, args, { signal })),
      signal,
    );
  };
  const started = Date.now();
  let graceHead;
  let graceStarted = started;
  for (;;) {
    const view = await call("github_pull_request_view");
    if (view?.state === "CLOSED" || view?.state === "MERGED")
      return { state: "closed", prState: view.state, pullNumber };
    if (view?.state !== "OPEN") throw new Error("Cannot establish a valid pull request state");
    if (!/^[a-f\d]{40}$/i.test(view.headRefOid ?? "")) throw new Error("Cannot establish the pull request head");
    const headSha = view.headRefOid.toLowerCase();
    if (headSha !== graceHead) {
      graceHead = headSha;
      graceStarted = Date.now();
    }
    if (!Array.isArray(view.statusCheckRollup)) throw new Error("Cannot establish the pull request checks");
    const check = summarizeChecks(view.statusCheckRollup);
    if (check.state === "pending" || (check.state === "none" && Date.now() - graceStarted < noChecksGraceMs)) {
      await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("Aborted"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, pollIntervalMs);
        signal?.addEventListener("abort", abort, { once: true });
      });
      continue;
    }
    const result = {
      ...check,
      pullNumber,
      headSha,
      headDiffersFromPush: Boolean(headSha && sha && headSha !== String(sha).toLowerCase()),
      waitedSeconds: (Date.now() - started) / 1000,
    };
    if (check.state === "failure") {
      for (const failure of check.failures) {
        const runId = Number(/\/actions\/runs\/(\d+)/.exec(failure.url ?? "")?.[1]);
        if (runId) {
          try {
            const log = await call("github_workflow_run_failed_log", {
              repo: repository.repo,
              runId,
              maxChars: MAX_LOG_CHARS,
            });
            failure.logTail = typeof log === "string" ? log : (log?.logTail ?? log?.log ?? "");
          } catch (error) {
            if (signal?.aborted) throw error;
          }
        }
      }
      return { ...result, followUp: ciFollowUp({ pullNumber, sha: headSha, failures: check.failures }) };
    }
    const files = await call("github_pull_request_files");
    if (!Array.isArray(files)) throw new Error("Cannot establish changed pull request files");
    // An empty or unidentifiable file list cannot prove that no gate files changed on this snapshot's head.
    if (headOf(files) !== headSha)
      throw new Error("Cannot establish that changed pull request files match the verified head");
    const gateFiles = gateFilesOf(files);
    return { ...result, gateFiles };
  }
}
