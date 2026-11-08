import { createHash } from "node:crypto";

export function gateCode(head, files) {
  return createHash("sha256")
    .update(`${head}\n${[...files].sort().join("\n")}`)
    .digest("hex")
    .slice(0, 8);
}

// The CI evidence of one check: its state for an exact head, at an exact time. `none` (no checks reported),
// `unavailable` (the checks could not be read) and `closed` are never green; only `success` is.
const ciSummary = (check, rounds, checkedAt) => ({
  state: check.state,
  pullNumber: check.pullNumber,
  headSha: check.headSha,
  checkedAt,
  rounds,
  checks: (check.checks ?? []).map(({ name, conclusion }) => ({ name, conclusion })),
  waitedSeconds: check.waitedSeconds,
  headDiffersFromPush: check.headDiffersFromPush,
});

// A member that opened a pull request completes only when CI says so. Red CI resumes the member's own session.
// `onCheck(handle, ci)` receives every CI snapshot, red rounds included, so the status can show the latest one.
export function createCiGate({ setState, scrub, maxCiRounds, now, onCheck }) {
  // Changes to the files that define the checks, scoped to the pull request and verified head.
  const askedGate = new Map();
  const acknowledgedGate = new Map();
  const needsInput = (result, question, ci) => ({ ...result, status: "needs_input", question, ...(ci ? { ci } : {}) });

  async function gate(handle, agent, first, signal) {
    let result = first;
    for (let round = 1; result.status === "completed" && agent.verify; round += 1) {
      setState(handle, "ci");
      let check;
      try {
        check = await agent.verify({ result, signal });
      } catch (error) {
        if (signal.aborted) return { ...result, status: "cancelled" };
        const detail = scrub(String(error?.message ?? error)).slice(0, 300);
        const ci = { state: "unavailable", checkedAt: now(), rounds: round, detail };
        onCheck(handle, ci);
        return needsInput(result, `I could not check CI for your pull request: ${detail}`, ci);
      }
      if (signal.aborted) return { ...result, status: "cancelled" };
      if (!check) return result;
      const ci = ciSummary(check, round, now());
      onCheck(handle, ci);
      if (check.state === "success" || check.state === "none") {
        const head = check.headSha;
        if ((check.gateFiles ?? []).length && !head)
          return needsInput(result, "Cannot establish the verified pull request head for the changed check files.", ci);
        let acknowledged = acknowledgedGate.get(handle);
        if (!acknowledged || acknowledged.head !== head || acknowledged.pullNumber !== check.pullNumber) {
          acknowledged = { head, pullNumber: check.pullNumber, files: new Set() };
          acknowledgedGate.set(handle, acknowledged);
        }
        const files = (check.gateFiles ?? []).filter((file) => !acknowledged.files.has(file));
        if (!files.length) return { ...result, ci };
        askedGate.set(handle, { files, head, pullNumber: check.pullNumber });
        return needsInput(
          result,
          `CI is ${check.state === "none" ? "absent" : "green"} on pull request #${check.pullNumber}, but the change touches files that define the checks: ${files.join(", ")}. Reply \`accept ${gateCode(head, files)}\` to accept these changes to the checks, or ask the member to fix the content instead.`,
          { ...ci, gateFiles: files },
        );
      }
      if (check.state === "closed")
        return needsInput(
          result,
          `Pull request #${check.pullNumber} is ${String(check.prState).toLowerCase()}; CI cannot be checked.`,
          ci,
        );
      if (round > maxCiRounds)
        return needsInput(
          result,
          `CI is still red on pull request #${check.pullNumber} after ${maxCiRounds} attempts to fix it: ${(check.failures ?? []).map((f) => f.name).join(", ")}.`,
          { ...ci, failures: (check.failures ?? []).map(({ name, url }) => ({ name, url })) },
        );
      setState(handle, "running");
      result = await agent.run.prompt(check.followUp);
    }
    return result;
  }

  // Only the exact confirmation for the question that was actually asked accepts its files. Any message ends the
  // question; a hold does not, because it does not answer it.
  function answer(handle, text) {
    const asked = askedGate.get(handle);
    if (!asked) return;
    const reply = /^accept ([0-9a-f]{8})$/i.exec(text.trim());
    if (reply && reply[1] === gateCode(asked.head, asked.files))
      for (const file of asked.files) acknowledgedGate.get(handle).files.add(file);
    askedGate.delete(handle);
  }

  return { gate, answer };
}
