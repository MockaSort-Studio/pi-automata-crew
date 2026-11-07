import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { findHostPi } from "../../extensions/crew/runner/pi-host.mjs";

const register = new URL("../../extensions/crew/runner/pi-resolve-register.mjs", import.meta.url).pathname;

// A fake "user's Pi" installation, and an app that is nowhere near it.
function world(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-resolve-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pi = join(root, "host", "lib", "node_modules", "@earendil-works", "pi-coding-agent");
  mkdirSync(join(pi, "dist", "bundle"), { recursive: true });
  mkdirSync(join(pi, "node_modules", "typebox"), { recursive: true });
  writeFileSync(
    join(pi, "package.json"),
    JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module", exports: "./index.mjs" }),
  );
  writeFileSync(join(pi, "index.mjs"), 'export const who = "the user\'s Pi";\n');
  writeFileSync(join(pi, "dist", "bundle", "cli.js"), "// cli\n");
  writeFileSync(
    join(pi, "node_modules", "typebox", "package.json"),
    JSON.stringify({ name: "typebox", type: "module", exports: "./index.mjs" }),
  );
  writeFileSync(join(pi, "node_modules", "typebox", "index.mjs"), 'export const who = "Pi\'s typebox";\n');
  mkdirSync(join(root, "bin"));
  symlinkSync(join(pi, "dist", "bundle", "cli.js"), join(root, "bin", "pi"));
  mkdirSync(join(root, "app"));
  writeFileSync(
    join(root, "app", "entry.mjs"),
    'import { who } from "@earendil-works/pi-coding-agent";\nimport { who as tb } from "typebox";\nconsole.log(who, "/", tb);\n',
  );
  return { root, pi, manifest: pathToFileURL(join(pi, "package.json")).href };
}
const run = (root, env) =>
  spawnSync(
    process.execPath,
    [...(env.CREW_PI_PARENT_URL ? ["--import", register] : []), join(root, "app", "entry.mjs")],
    { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" },
  );

test("the host process resolves Pi's packages from the user's Pi, not from wherever it happens to run", (t) => {
  const { root, manifest } = world(t);
  const without = run(root, {});
  assert.notEqual(without.status, 0, "no Pi packages are reachable from the app on its own");
  assert.match(without.stderr, /Cannot find package/);
  const withHook = run(root, { CREW_PI_PARENT_URL: manifest });
  assert.equal(withHook.status, 0, withHook.stderr);
  assert.equal(withHook.stdout.trim(), "the user's Pi / Pi's typebox");
});

test("only Pi's peers are redirected: the extension's own dependencies, even under the same scope, resolve normally", (t) => {
  const { root, manifest } = world(t);
  // Gondolin shares Pi's npm scope but is this extension's own dependency, not one Pi provides.
  const own = join(root, "app", "node_modules", "@earendil-works", "gondolin");
  mkdirSync(own, { recursive: true });
  writeFileSync(
    join(own, "package.json"),
    JSON.stringify({ name: "@earendil-works/gondolin", type: "module", exports: "./index.mjs" }),
  );
  writeFileSync(join(own, "index.mjs"), 'export const who = "our own gondolin";\n');
  writeFileSync(
    join(root, "app", "entry.mjs"),
    'import { who } from "@earendil-works/gondolin";\nimport { who as pi } from "@earendil-works/pi-coding-agent";\nconsole.log(who, "/", pi);\n',
  );
  const result = run(root, { CREW_PI_PARENT_URL: manifest });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "our own gondolin / the user's Pi");
  assert.doesNotMatch(result.stderr, /DEP0205/, "uses the supported in-thread hooks API");
});

test("only Pi's packages are redirected: other bare imports resolve normally", (t) => {
  const { root, manifest } = world(t);
  writeFileSync(join(root, "app", "entry.mjs"), 'import "some-other-package";\n');
  const result = run(root, { CREW_PI_PARENT_URL: manifest });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find package 'some-other-package'/);
});

test("the user's Pi is found from the running Pi's entry point, through a symlinked bin", (t) => {
  const { root, pi } = world(t);
  // The real path: temp directories are themselves symlinks on some systems (macOS /var).
  assert.equal(findHostPi(join(root, "bin", "pi")), pathToFileURL(realpathSync(join(pi, "package.json"))).href);
  assert.equal(findHostPi(join(root, "app", "entry.mjs")), undefined, "not running under an installed Pi");
  assert.equal(findHostPi(undefined), undefined);
  assert.equal(findHostPi(join(root, "does-not-exist")), undefined);
});
