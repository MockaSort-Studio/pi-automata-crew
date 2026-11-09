import { strict as assert } from "node:assert";
import test from "node:test";
import { createEnvironment } from "../../extensions/crew/runner/environment.mjs";
import { prepareDependencyMount, GUEST_SOURCES } from "../../extensions/crew/runner/dependency-mount.mjs";
import { skipLiveGondolin } from "./live-gondolin.mjs";

// Exit codes: 10-29 a writable /workspace control failed; 30-49 a source-mount
// mutation succeeded; 130-149 it failed with an error other than EROFS; 50-59
// the source bytes or metadata changed.
const SCRIPT = `set -e
src=${GUEST_SOURCES}/prettier
target=$src/package.json
test -r "$target"
snapshot() { stat -c '%a %s' "$1"; sha256sum "$1"; }
deny() {
  code=$1; shift
  if out=$("$@" 2>&1); then exit "$code"; fi
  case "$out" in *"Read-only file system"*) ;; *) echo "$code: $out" >&2; exit $((code + 100)) ;; esac
}
noop_or_deny() {
  code=$1; shift
  if ! out=$("$@" 2>&1); then
    case "$out" in *"Read-only file system"*) ;; *) echo "$code: $out" >&2; exit $((code + 100)) ;; esac
  fi
}

# Writable controls: each command form below succeeds on /workspace.
probe=/workspace/probe
mkdir "$probe" || exit 10
touch "$probe/a" || exit 11
echo data > "$probe/a" || exit 12
echo more >> "$probe/a" || exit 13
test "$(cat "$probe/a")" = "data
more" || exit 14
# chmod must be accepted on the writable workspace; whether this host's workspace layer applies the mode varies, so the
# mode value is not asserted (the source-mount check below asserts the snapshot metadata stays unchanged).
chmod 600 "$probe/a" || exit 15
truncate -s 1 "$probe/a" || exit 17
test "$(stat -c %s "$probe/a")" = 1 || exit 18
ln "$probe/a" "$probe/hard" || exit 19
ln -s a "$probe/sym" || exit 20
mv "$probe/a" "$probe/b" || exit 21
rm "$probe/b" "$probe/hard" "$probe/sym" || exit 22
rmdir "$probe" || exit 23
touch /workspace/move-source || exit 24

before=$(snapshot "$target")
deny 30 sh -c 'echo bad > "$1"' _ "$target"
deny 31 sh -c 'echo bad >> "$1"' _ "$target"
deny 32 truncate -s 0 "$target"
deny 33 rm "$target"
deny 34 mv "$target" "$src/renamed"
deny 35 mv /workspace/move-source "$src/new"
deny 36 ln -s /workspace/move-source "$src/new"
deny 37 ln "$target" "$src/new"
deny 38 mkdir "$src/new"
deny 39 touch "$src/new"
deny 40 sh -c 'echo bad > "$1"' _ "$src/new"
deny 43 mv "$target" /workspace/stolen
rm -f /workspace/stolen
test ! -e "$src/new" || exit 50
test ! -e "$src/renamed" || exit 51

# chmod and touch on an existing snapshot file may report success through the
# guest file layer; they must still leave mode, size and content unchanged.
noop_or_deny 41 chmod 600 "$target"
test "$(snapshot "$target")" = "$before" || exit 52
noop_or_deny 42 touch "$target"
test "$(snapshot "$target")" = "$before" || exit 53
rm -f /workspace/move-source

printf 'const x={a:1}\\n' > /workspace/format.js
node "$src/bin/prettier.cjs" --write /workspace/format.js
cat /workspace/format.js`;

test("verified formatter runs in the guest and source mount denies writes", { timeout: 120_000 }, async (t) => {
  if (skipLiveGondolin(t)) return;
  const sources = await prepareDependencyMount();
  assert.ok(sources.available.includes("prettier"), sources.failures.join("; "));
  const environment = createEnvironment({ localCwd: "/unused", dependencySources: sources.provider, idleMs: 0 });
  t.after(() => environment.close());
  const result = await environment.withVm((vm) => vm.exec(SCRIPT));
  assert.equal(result.exitCode, 0, `exit ${result.exitCode}: ${result.stderr}`);
  assert.match(result.stdout, /const x = \{ a: 1 \};/);
  assert.equal(String(await environment.workspace.readFile("/format.js")), "const x = { a: 1 };\n");
});
