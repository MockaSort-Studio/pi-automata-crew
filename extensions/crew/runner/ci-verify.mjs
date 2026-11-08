// A member that opened a pull request is not done until its CI is green. The runner, not the model, checks: it finds
// the member's PR and last pushed commit in the run's evidence and asks the GitHub suite to wait for that commit's
// checks. A red result is turned into a message for the member's own session, with the failing checks and log tails.
const PULL_URL = /\/pull\/(\d+)(?:[/?#]|$)/;
const MAX_FOLLOW_UP_CHARS = 8000;
const MAX_LOG_CHARS = 2500;

export const pullNumberOf = (url) => Number(PULL_URL.exec(String(url ?? ""))?.[1]) || undefined;

// A green CI means nothing if the change weakened the checks. These paths define them (CI workflows, formatter and
// linter ignore lists and configs, test-runner configs); a pull request that touches one is reported to Main even
// when CI is green. It is deliberately generic and short: a reviewer still reads the diff.
const GATE_FILES = [
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
    const conclusion = String(isRun ? entry.conclusion ?? "" : entry.state ?? "").toLowerCase();
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
  return { state: !checks.length ? "none" : failures.length ? "failure" : checks.some((c) => c.pending) ? "pending" : "success", checks, failures };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

const headOf = (files) => {
  const heads = new Set(files.map((file) => /\/blob\/([a-f\d]{40})\//i.exec(file.blob_url ?? "")?.[1]?.toLowerCase()));
  return heads.size === 1 ? [...heads][0] : undefined;
};

export async function verifyPullRequest({ ops, policy, evidence, signal, pollIntervalMs = 15000, noChecksGraceMs = 90000 }) {
  const pullNumber = pullNumberOf(evidence?.pullRequest);
  if (!pullNumber) return null;
  const sha = evidence?.pushed?.commit;
  const input = { repo: policy.repo, pullNumber };
  const call = (name, args = input) => abortable(Promise.resolve().then(() => ops.call(name, args, { signal })), signal);
  const started = Date.now();
  for (;;) {
    const view = await call("github_pull_request_view");
    if (view.state !== "OPEN") return { state: "closed", prState: view.state, pullNumber };
    const before = await call("github_pull_request_files");
    const check = summarizeChecks(await call("github_pull_request_checks"));
    const files = await call("github_pull_request_files");
    const headSha = headOf(files);
    if (headOf(before) !== headSha) continue;
    if (check.state === "pending" || (check.state === "none" && Date.now() - started < noChecksGraceMs)) {
      await abortable(new Promise((resolve) => {
        const timer = setTimeout(resolve, pollIntervalMs);
        signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
      }), signal);
      continue;
    }
    const result = { ...check, pullNumber, headSha, headDiffersFromPush: Boolean(headSha && sha && headSha !== String(sha).toLowerCase()), waitedSeconds: (Date.now() - started) / 1000 };
    if (check.state === "failure") {
      for (const failure of check.failures) {
        const runId = Number(/\/actions\/runs\/(\d+)/.exec(failure.url ?? "")?.[1]);
        if (runId) {
          try {
            const log = await call("github_workflow_run_failed_log", { repo: policy.repo, runId, maxChars: MAX_LOG_CHARS });
            failure.logTail = typeof log === "string" ? log : log?.logTail ?? log?.log ?? "";
          } catch (error) {
            if (signal?.aborted) throw error;
          }
        }
      }
      return { ...result, followUp: ciFollowUp({ pullNumber, sha: headSha, failures: check.failures }) };
    }
    const gateFiles = gateFilesOf(files);
    if (gateFiles.length && !headSha) throw new Error("Cannot establish the pull request head for changed gate files");
    return { ...result, gateFiles };
  }
}
