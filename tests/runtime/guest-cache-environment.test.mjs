import { strict as assert } from "node:assert";
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
    assert.equal(options.env.XDG_CACHE_HOME, "/tmp/xdg-cache");
    assert.equal(options.env.npm_config_cache, "/tmp/npm-cache");
    assert.equal(options.env.CACHE_DIR, "/tmp/cache");
  } finally {
    await environment.close();
  }
});
