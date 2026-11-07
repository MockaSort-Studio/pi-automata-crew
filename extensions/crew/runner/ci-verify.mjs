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

// `ops.call(name, input, { signal })` runs a suite operation on the host. Returns null when the run has no pull
// request (nothing to gate); otherwise the suite's result plus the pull request number and, for a failure, the
// follow-up message.
export async function verifyPullRequest({ ops, policy, evidence, signal }) {
  const pullNumber = pullNumberOf(evidence?.pullRequest);
  if (!pullNumber) return null;
  const sha = evidence?.pushed?.commit;
  const check = await ops.call(
    "github_pull_request_checks_wait",
    { repo: policy.repo, pullNumber, ...(sha ? { sha } : {}) },
    { signal },
  );
  if (check.state === "failure")
    return { ...check, pullNumber, followUp: ciFollowUp({ pullNumber, sha, failures: check.failures }) };
  // Green (or no checks): was it made green by changing the checks themselves?
  const files = await ops.call("github_pull_request_files", { repo: policy.repo, pullNumber }, { signal });
  return { ...check, pullNumber, gateFiles: gateFilesOf(Array.isArray(files) ? files : []) };
}
