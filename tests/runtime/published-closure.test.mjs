import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireNixGuestSuite, fetchPublishedClosure, guestNixSystem } from "../../.pi/extensions/hall-crew/env-runtime/lib/armory-nix.mjs";

const cache = { substituter: "https://cache.example", publicKey: "k" };
const root = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-suite";
const dep = "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-gh";
const narHash = `sha256-${"A".repeat(43)}=`;
const artifact = {
  storePath: root,
  narHash,
  closure: [root, dep].map((path) => ({ path, narHash, narSize: 1 })),
};
const installed = (overrides = {}) =>
  JSON.stringify({ [root]: { narHash }, [dep]: { narHash }, ...overrides });

function execute(calls, info = installed()) {
  return async (_nix, args) => {
    calls.push(args);
    return { stdout: args[0] === "path-info" ? info : `${root}\n` };
  };
}

test("fetches by store path from the cache, verifies the closure, then roots it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "published-"));
  try {
    const calls = [];
    const gcRoot = join(dir, "roots", "suite");
    const result = await fetchPublishedClosure({ artifact, cache, gcRoot, execute: execute(calls) });
    assert.deepEqual(calls.map((args) => args[0]), ["copy", "path-info", "build"]);
    assert.deepEqual(calls[0], ["copy", "--from", cache.substituter, root]);
    assert.deepEqual(calls[2], ["build", "--out-link", gcRoot, "--print-out-paths", root]);
    assert.deepEqual(result, { rootPath: root, paths: [root, dep].sort() });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a closure that differs from the catalog is rejected before rooting", async () => {
  const calls = [];
  const extra = "/nix/store/cccccccccccccccccccccccccccccccc-extra";
  await assert.rejects(
    fetchPublishedClosure({ artifact, cache, gcRoot: "/tmp/x", execute: execute(calls, installed({ [extra]: { narHash } })) }),
    /differs from the published/,
  );
  assert.ok(!calls.some((args) => args[0] === "build"));
});

test("content that differs from the promised hash is rejected", async () => {
  const other = `sha256-${"B".repeat(43)}=`;
  await assert.rejects(
    fetchPublishedClosure({ artifact, cache, gcRoot: "/tmp/x", execute: execute([], installed({ [dep]: { narHash: other } })) }),
    /Content of .* differs/,
  );
});

const catalog = (artifacts) => ({
  flake: "github:MockaSort-Studio/hall-armory/0123456789abcdef0123456789abcdef01234567",
  catalog: { format: "hall.armory/v1", lockers: [{ name: "collaboration", suites: [{ extension: "pi-github-tools", manifest: "collaboration/github/manifest.json" }] }] },
  manifests: {
    "collaboration/github/manifest.json": {
      format: "hall.armory-suite/v1",
      extension: "pi-github-tools",
      package: { name: "@x/y", version: "1.0.0", integrity: `sha512-${"A".repeat(86)}==` },
      summary: "s",
      capabilities: ["issues"],
      native: { closure: ".", output: "guest" },
      network: { allowedHosts: ["api.github.com"], credentials: [] },
      tools: ["github_issue_view"],
    },
  },
  artifacts,
});
const request = { suite: "collaboration/pi-github-tools", tools: ["github_issue_view"] };

test("a published artifact for this system is fetched by store path", async () => {
  const result = await acquireNixGuestSuite({
    catalog: catalog({ [request.suite]: { [guestNixSystem()]: artifact } }),
    request,
    fetchPublished: async ({ artifact: wanted, cache: used }) => {
      assert.equal(wanted.storePath, root);
      assert.match(used.substituter, /^https:\/\/hall-armory\.cachix\.org$/);
      return { rootPath: root, paths: [root, dep] };
    },
  });
  assert.equal(result.rootPath, root);
  assert.deepEqual(result.tools, ["github_issue_view"]);
});

test("an unusable published closure is an error, with no flake fallback", async () => {
  await assert.rejects(
    acquireNixGuestSuite({
      catalog: catalog({ [request.suite]: { [guestNixSystem()]: artifact } }),
      request,
      fetchPublished: async () => Promise.reject(new Error("cache offline")),
    }),
    /cache offline/,
  );
});

test("a suite the release does not carry for this system is an error", async () => {
  await assert.rejects(acquireNixGuestSuite({ catalog: catalog({ [request.suite]: {} }), request }), /no (aarch64|x86_64)-linux artifact/);
  await assert.rejects(acquireNixGuestSuite({ catalog: catalog(undefined), request }), /no .* artifact/);
});
