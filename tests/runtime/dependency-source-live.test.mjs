import { strict as assert } from "node:assert";
import test from "node:test";
import { createEnvironment } from "../../extensions/crew/runner/environment.mjs";
import { prepareDependencyMount, GUEST_SOURCES } from "../../extensions/crew/runner/dependency-mount.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

test("verified formatter runs in the guest and source mount denies writes", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const sources = await prepareDependencyMount();
  assert.ok(sources.available.includes("prettier"), sources.failures.join("; "));
  const environment = createEnvironment({ localCwd: "/unused", dependencySources: sources.provider, idleMs: 0 });
  t.after(() => environment.close());
  const result = await environment.withVm((vm) =>
    vm.exec(`set -e
    test -r ${GUEST_SOURCES}/prettier/package.json
    if echo bad > ${GUEST_SOURCES}/prettier/package.json 2>/dev/null; then exit 12; fi
    printf 'const x={a:1}\n' > /workspace/format.js
    node ${GUEST_SOURCES}/prettier/bin/prettier.cjs --write /workspace/format.js
    cat /workspace/format.js`),
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /const x = \{ a: 1 \};/);
  assert.equal(String(await environment.workspace.readFile("/format.js")), "const x = { a: 1 };\n");
});
