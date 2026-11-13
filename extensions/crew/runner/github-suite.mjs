import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  authorizeRepositoryOperation,
  ownPullRequestOperations,
} from "../env-runtime/lib/repository-authorization.mjs";
import { discardPrivateCopy } from "./armory-source.mjs";
import { workspaceFs } from "./workspace-fs.mjs";

const run = promisify(execFile);
const MAX_REVIEW_STARTS = 1024;
const MAX_RECORDED_REVIEWS = 256;

// How the suite's `gh` runs on the host. The Crew's own token is the only credential: it is set explicitly,
// and gh's own config directory is an empty private one, so the user's stored login can never be used and
// the agent's VM never sees the token at all. Asynchronous, so a slow GitHub call never blocks other agents.
export function hostGhTransport({ token, exec = run }) {
  if (!token) throw new Error("The GitHub suite requires a Crew token (HALL_GITHUB_TOKEN)");
  const configDir = mkdtempSync(join(tmpdir(), "crew-gh-"));
  const env = {
    PATH: process.env.PATH,
    HOME: configDir,
    GH_CONFIG_DIR: configDir,
    GH_TOKEN: token,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
  };
  return {
    async run(args, options = {}) {
      // Compatibility adapter for the pinned Armory release: its PR view selects the rollup but omits the head.
      // Add the head to the same gh snapshot, without changing ownership queries or any other command.
      let commandArgs = args;
      if (args[0] === "pr" && args[1] === "view") {
        const index = args.indexOf("--json");
        const fields = index >= 0 && typeof args[index + 1] === "string" ? args[index + 1].split(",") : [];
        if (fields.includes("statusCheckRollup") && !fields.includes("headRefOid")) {
          commandArgs = [...args];
          commandArgs[index + 1] = [...fields, "headRefOid"].join(",");
        }
      }
      const { stdout } = await exec("gh", commandArgs, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        ...options,
        env,
      });
      return stdout;
    },
  };
}

// Imports a suite bundle. A private copy made by `fetchSuiteExtension` is discarded once imported.
export async function loadSuiteModule(path) {
  try {
    return await import(pathToFileURL(path).href);
  } finally {
    discardPrivateCopy(path);
  }
}

const injection = ({ workspace, token, transport }) => ({
  commandTransport: transport,
  workspace: { fs: workspaceFs(workspace), dir: "/", env: { GITHUB_TOKEN: token } },
});

// The suite's operations as plain calls, for the runner's own use (salvage). Same code and injection as an
// agent's tools, but independent of any session. Policy is the caller's responsibility here: the runner
// only ever acts on the branch and revision it derived itself.
export function createSuiteOperations({ module, workspace, token, transport = hostGhTransport({ token }) }) {
  const registry = new Map();
  module.activateSuite(
    { registerTool: (tool) => registry.set(tool.name, tool), on() {} },
    injection({ workspace, token, transport }),
  );
  return {
    async call(name, input, { signal } = {}) {
      const tool = registry.get(name);
      if (!tool) throw new Error(`The suite has no operation ${name}`);
      const result = await tool.execute(`runner-${name}`, input, signal);
      const text = (result?.content ?? []).map((part) => part.text ?? "").join("");
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  };
}

// An extension factory that installs the GitHub suite for one agent. The suite is the Armory's generic
// code; everything specific to this agent is injected: where Git acts (the environment's workspace), how gh
// runs (the Crew token), and, here, the repository policy, enforced before any guarded call executes.
// `ready` resolves once the workspace is seeded: these tools never touch the VM, which is what seeds it.
export function githubSuiteExtension({
  module,
  workspace,
  token,
  policy,
  ready,
  transport = hostGhTransport({ token }),
}) {
  return (pi) => {
    const reviews = new Map();
    const pendingReviews = new Map();
    const issuedReviewStarts = new Set();
    module.activateSuite(pi, injection({ workspace, token, transport }));
    pi.on("tool_call", async (event) => {
      if (!event.toolName.startsWith("github_")) return;
      try {
        authorizeRepositoryOperation(event.toolName, event.input, policy);
      } catch (error) {
        return { block: true, reason: error.message };
      }
      if (
        event.toolName === "github_pull_request_review_inline_comment" ||
        event.toolName === "github_pull_request_review_submit"
      ) {
        const review = reviews.get(event.input.reviewId);
        if (
          !review ||
          (event.toolName === "github_pull_request_review_inline_comment" &&
            (event.input.repo !== review.repo || event.input.pullNumber !== review.pullNumber))
        )
          return { block: true, reason: "Review ID was not started for this target in this session" };
      }
      if (ownPullRequestOperations.has(event.toolName)) {
        try {
          const pr = JSON.parse(
            await transport.run([
              "pr",
              "view",
              String(event.input.pullNumber),
              "--repo",
              policy.repo,
              "--json",
              "headRefName,baseRefName,isCrossRepository",
            ]),
          );
          if (pr.headRefName !== policy.branch || pr.baseRefName !== policy.base || pr.isCrossRepository !== false)
            throw new Error("not owned");
        } catch {
          return { block: true, reason: "A worker can only change its own pull request" };
        }
      }
      if (event.toolName === "github_pull_request_create") event.input.draft = true;
      try {
        await ready?.();
      } catch (error) {
        return { block: true, reason: `The workspace could not be prepared: ${error.message}` };
      }
      if (event.toolName === "github_pull_request_review_start") {
        if (
          typeof event.toolCallId !== "string" ||
          !event.toolCallId ||
          issuedReviewStarts.has(event.toolCallId) ||
          !Number.isInteger(event.input.pullNumber) ||
          event.input.pullNumber <= 0
        )
          return { block: true, reason: "Review start requires a unique call ID and valid pull number" };
        if (issuedReviewStarts.size >= MAX_REVIEW_STARTS)
          return { block: true, reason: "Review start limit reached for this session" };
        if (reviews.size >= MAX_RECORDED_REVIEWS)
          return { block: true, reason: "Recorded review limit reached for this session" };
        issuedReviewStarts.add(event.toolCallId);
        pendingReviews.set(event.toolCallId, { repo: event.input.repo, pullNumber: event.input.pullNumber });
      }
    });
    pi.on("tool_result", (event) => {
      if (event.toolName === "github_pull_request_review_submit" && !event.isError)
        reviews.delete(event.input?.reviewId);
      if (event.toolName === "github_pull_request_review_start") {
        const pending = pendingReviews.get(event.toolCallId);
        pendingReviews.delete(event.toolCallId);
        if (!pending || event.isError) return;
        let result = event.details;
        if (!result) {
          try {
            result = JSON.parse(event.content?.find((part) => part.type === "text")?.text);
          } catch {}
        }
        if (
          result?.repo === pending.repo &&
          result?.pullNumber === pending.pullNumber &&
          typeof result?.reviewId === "string" &&
          result.reviewId.length > 0 &&
          result.reviewId.length <= 256 &&
          !reviews.has(result.reviewId) &&
          reviews.size < MAX_RECORDED_REVIEWS
        )
          reviews.set(result.reviewId, pending);
      }
      if (event.toolName === "github_pull_request_create" && !event.isError)
        return {
          content: [...event.content, { type: "text", text: "Crew policy created this pull request as a draft." }],
        };
    });
  };
}
