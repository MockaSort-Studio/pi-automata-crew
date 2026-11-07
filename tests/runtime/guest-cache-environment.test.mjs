import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createEnvironment } from "../../extensions/crew/runner/environment.mjs";

test("guest shell commands receive writable cache locations under /tmp", async () => {
  let options;
  const environment = createEnvironment({
    localCwd: "/repo",
    vmm: "test",
    createVm: async (value) => {
      options = value;
      return { close: async () => {} };
    },
  });
  try {
    await environment.withVm(async () => {});
    for (const key of ["XDG_CACHE_HOME", "npm_config_cache"]) {
      assert.match(options.env[key], /^\/tmp\//);
    }
    execFileSync(
      "/bin/sh",
      [
        "-c",
        'a=$(mktemp "$XDG_CACHE_HOME/crew-test.XXXXXX") && b=$(mktemp "$npm_config_cache/crew-test.XXXXXX") && rm "$a" "$b"',
      ],
      { env: options.env },
    );
  } finally {
    await environment.close();
  }
});
