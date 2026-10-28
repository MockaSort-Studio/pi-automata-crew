import assert from "node:assert/strict";
import test from "node:test";
import { createGuestSuiteRunner } from "../../.pi/extensions/hall-crew/env-runtime/lib/guest-suite.mjs";

const rootPath = "/nix/store/0123456789abcdefghijklmnopqrstuv-github-guest";

function guest(result, exitCode = 0) {
  const files = new Map();
  return {
    fs: {
      async writeFile(path, contents) { files.set(path, contents); },
      async readFile() { return JSON.stringify(result); },
    },
    async exec(argv) {
      if (argv[0].endsWith("armory-suite")) {
        const request = JSON.parse(files.get(argv[2]));
        assert.deepEqual(request.operations, ["github_issue_view"]);
      }
      return { exitCode };
    },
  };
}

test("guest runner describes only approved guest operations", async () => {
  const runner = createGuestSuiteRunner({
    guest: guest({ operations: [{ name: "github_issue_view", description: "View", parameters: {} }] }),
    rootPath,
    operations: ["github_issue_view"],
    uuid: () => "run",
  });
  assert.equal((await runner.describe())[0].name, "github_issue_view");
});

test("guest runner rejects host-unapproved operations before guest execution", async () => {
  const runner = createGuestSuiteRunner({
    guest: guest({ result: {} }), rootPath, operations: ["github_issue_view"], uuid: () => "run",
  });
  await assert.rejects(() => runner.invoke("github_issue_create", {}), /not approved/);
});

test("guest runner returns guest structured errors", async () => {
  const runner = createGuestSuiteRunner({
    guest: guest({ error: { message: "denied" } }, 1), rootPath, operations: ["github_issue_view"], uuid: () => "run",
  });
  await assert.rejects(() => runner.invoke("github_issue_view", {}), /denied/);
});
