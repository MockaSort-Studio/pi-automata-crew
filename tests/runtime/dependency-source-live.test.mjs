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
    target=${GUEST_SOURCES}/prettier/package.json
    before=$(sha256sum "$target")
    mkdir /workspace/probe
    touch /workspace/probe/a
    chmod 600 /workspace/probe/a
    truncate -s 1 /workspace/probe/a
    ln /workspace/probe/a /workspace/probe/hard
    ln -s a /workspace/probe/sym
    mv /workspace/probe/a /workspace/probe/b
    rm /workspace/probe/b /workspace/probe/hard /workspace/probe/sym
    rmdir /workspace/probe
    touch /workspace/move-source
    if echo bad > "$target" 2>/dev/null; then exit 12; fi
    if mv "$target" /workspace/stolen 2>/dev/null; then exit 13; fi
    if mv /workspace/move-source ${GUEST_SOURCES}/prettier/new 2>/dev/null; then exit 14; fi
    if ln -s /workspace/move-source ${GUEST_SOURCES}/prettier/new 2>/dev/null; then exit 15; fi
    if ln "$target" ${GUEST_SOURCES}/prettier/new 2>/dev/null; then exit 16; fi
    if mkdir ${GUEST_SOURCES}/prettier/new 2>/dev/null; then exit 17; fi
    if touch "$target" 2>/dev/null; then exit 18; fi
    if truncate -s 0 "$target" 2>/dev/null; then exit 19; fi
    if rm "$target" 2>/dev/null; then exit 20; fi
    if chmod 600 "$target" 2>/dev/null; then exit 21; fi
    test "$(sha256sum "$target")" = "$before"
    printf 'const x={a:1}\n' > /workspace/format.js
    node ${GUEST_SOURCES}/prettier/bin/prettier.cjs --write /workspace/format.js
    cat /workspace/format.js`),
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /const x = \{ a: 1 \};/);
  assert.equal(String(await environment.workspace.readFile("/format.js")), "const x = { a: 1 };\n");
});
