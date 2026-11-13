// Work must not be lost when a run ends early. After any run the runner itself, not the model, commits what
// is left uncommitted in the agent's workspace and pushes it to the agent's own authorized branch. Every
// step is an idempotent suite operation, so salvaging twice, or after the agent already pushed, is a no-op.
const CHUNK = 500;

export async function salvage({ ops, repository, member, reason }) {
  const { repo, revision, branch } = repository;
  try {
    const status = await ops.call("github_git_status", { repo });
    const paths = (status.files ?? []).map((file) => file.path).filter((path) => !path.split("/").includes(".git"));
    // An agent that never touched Git (a reviewer, say) leaves nothing to rescue and gets no remote branch.
    if (!status.branch && !paths.length) return { branch, skipped: true };
    // Checkout is idempotent: the first time it puts HEAD on the member's branch, afterwards it only says where
    // HEAD is. An agent that checked out and then changed nothing is still at the base revision: pushing that
    // would only leave an empty branch on the remote.
    const where = await ops.call("github_workspace_checkout", { repo, revision, branch });
    if (!paths.length && where?.head === revision) return { branch, skipped: true, reason: "no changes" };
    let committed;
    for (let index = 0; index < paths.length; index += CHUNK)
      await ops.call("github_git_stage", { repo, paths: paths.slice(index, index + CHUNK) });
    if (paths.length) {
      const result = await ops.call("github_git_commit", { repo, message: `wip: salvage ${member} (${reason})` });
      committed = result.commit;
    }
    const pushed = await ops.call("github_git_push", { repo, branch });
    return { branch, commit: pushed.commit, changed: paths.length, committed, upToDate: Boolean(pushed.upToDate) };
  } catch (error) {
    // Salvage never masks the run's own outcome; the failure is reported beside it.
    return { branch, error: String(error?.message ?? error).slice(0, 300) };
  }
}
