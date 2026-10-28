import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startGithubDiscussionAdapter } from "../../.pi/extensions/hall-crew/crew-runtime/lib/github-discussion.mjs";

// A fake `gh` on PATH: enough GraphQL responses for discussion creation,
// commenting, and the empty-comment poll, with every call logged so posted
// bodies can be inspected.
function fakeGh(dir, log) {
  const script = join(dir, "gh");
  writeFileSync(
    script,
    `#!/bin/sh
printf '%s\\0' "$*" >> "${log}"
case "$*" in
  *"repo view"*) printf 'owner/repo' ;;
  *"discussionCategories"*)
    [ "\${GH_FAKE_MODE:-}" = "missing-category" ] && printf '{"data":{"repository":{"id":"REPO1","discussionCategories":{"nodes":[]}}}}' || printf '{"data":{"repository":{"id":"REPO1","discussionCategories":{"nodes":[{"id":"CAT1","name":"General"}]}}}}' ;;
  *"createDiscussion"*)
    case "\${GH_FAKE_MODE:-}" in
      malformed-json) printf '{malformed' ;;
      forbidden) printf 'HTTP 403 forbidden' >&2; exit 1 ;;
      not-found) printf 'HTTP 404 not found' >&2; exit 1 ;;
      unprocessable) printf 'HTTP 422 validation failed' >&2; exit 1 ;;
      rate-limit) printf 'HTTP 429 rate limited' >&2; exit 1 ;;
      closed) printf '{"data":{"createDiscussion":{"discussion":null}}}' ;;
      *) printf '{"data":{"createDiscussion":{"discussion":{"id":"DISC1","number":1,"url":"https://example.test/d/1"}}}}' ;;
    esac ;;
  *"addDiscussionComment"*) printf '{"data":{"addDiscussionComment":{"comment":{"id":"C1","url":"https://example.test/c/1"}}}}' ;;
  *"comments(first:100"*)
    [ "\${GH_FAKE_MODE:-}" = "poll-error" ] && printf 'HTTP 429 rate limited' >&2 && exit 1
    [ "\${GH_FAKE_MODE:-}" = "closed-poll" ] && printf '{"data":{"repository":{"discussion":null}}}' || {
      case "\${GH_FAKE_MODE:-}:$*" in
        pagination:*after=CURSOR*) printf '{"data":{"repository":{"discussion":{"comments":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}' ;;
        pagination:*) printf '{"data":{"repository":{"discussion":{"comments":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"CURSOR"}}}}}}' ;;
        *) printf '{"data":{"repository":{"discussion":{"comments":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}' ;;
      esac
    } ;;
esac
`,
  );
  chmodSync(script, 0o755);
}

function fakeController() {
  let handler;
  return {
    subscribe(fn) {
      handler = fn;
      return () => {};
    },
    injectHuman() {
      return { accepted: true, id: "human-1" };
    },
    async emit(message) {
      return handler(message);
    },
  };
}

async function withAdapter(t, run, mode = "") {
  const dir = mkdtempSync(join(tmpdir(), "gh-discussion-"));
  const log = join(dir, "gh.log");
  fakeGh(dir, log);
  const oldPath = process.env.PATH;
  const oldMode = process.env.GH_FAKE_MODE;
  process.env.PATH = `${dir}:${oldPath}`;
  process.env.GH_FAKE_MODE = mode;
  const controller = fakeController();
  const stateFile = join(dir, "state.json");
  const adapter = await startGithubDiscussionAdapter(controller, {
    stateFile,
    runId: "run-1",
    startedAt: "2026-01-01T00:00:00Z",
    category: "General",
    recipients: { architect: "actor-architect" },
    lead: "actor-lead",
    pollIntervalMs: 60_000,
  });
  t.after(async () => {
    await adapter.stop();
    process.env.PATH = oldPath;
    if (oldMode === undefined) delete process.env.GH_FAKE_MODE;
    else process.env.GH_FAKE_MODE = oldMode;
    rmSync(dir, { recursive: true, force: true });
  });
  return { controller, log };
}

const postedBodies = (log) =>
  readFileSync(log, "utf8")
    .split("\0")
    .filter((call) => call.includes("addDiscussionComment"))
    .map((call) => call.match(/body=([^\u0000]*?)(?: -f id=| -f discussion=|$)/)?.[1] ?? "");

test("a long report body is truncated with a pointer instead of posted in full", async (t) => {
  const { controller, log } = await withAdapter(t);
  const long = "y".repeat(5000);
  await controller.emit({ id: "m1", kind: "notify", from: "actor-architect", to: "actor-lead", message: long });
  const bodies = postedBodies(log);
  assert.equal(bodies.length, 1);
  assert.ok(bodies[0].length < long.length);
  assert.match(bodies[0], /truncated/);
});

test("an identical repost to the same recipient is not posted twice", async (t) => {
  const { controller, log } = await withAdapter(t);
  const message = { id: "m1", kind: "notify", from: "actor-architect", to: "actor-lead", message: "Same report." };
  await controller.emit(message);
  await controller.emit({ ...message, id: "m2" });
  const bodies = postedBodies(log);
  assert.equal(bodies.length, 1);
});

test("distinct content to the same recipient is posted separately", async (t) => {
  const { controller, log } = await withAdapter(t);
  await controller.emit({ id: "m1", kind: "notify", from: "actor-architect", to: "actor-lead", message: "First." });
  await controller.emit({ id: "m2", kind: "notify", from: "actor-architect", to: "actor-lead", message: "Second." });
  const bodies = postedBodies(log);
  assert.equal(bodies.length, 2);
});

test("GitHub failures preserve status, operation, resource, and transient classification", async (t) => {
  for (const [mode, status, transient] of [
    ["forbidden", 403, false],
    ["not-found", 404, false],
    ["unprocessable", 422, false],
    ["rate-limit", 429, true],
  ]) {
    await assert.rejects(
      () => withAdapter(t, undefined, mode),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.transient, transient);
        assert.match(error.message, /create discussion/i);
        assert.match(error.message, /owner\/repo/);
        return true;
      },
    );
  }
});

test("malformed and closed GitHub resources fail with actionable context", async (t) => {
  await assert.rejects(() => withAdapter(t, undefined, "malformed-json"), /create discussion.*owner\/repo/i);
  await assert.rejects(
    () => withAdapter(t, undefined, "closed"),
    /create discussion.*owner\/repo.*closed|closed.*create discussion/i,
  );
});

test("missing category names the requested category", async (t) => {
  await assert.rejects(() => withAdapter(t, undefined, "missing-category"), /category.*General/i);
});

test("polling failure does not tear down the adapter", async (t) => {
  const { controller } = await withAdapter(t, undefined, "poll-error");
  await assert.doesNotReject(() =>
    controller.emit({ id: "m1", kind: "notify", from: "actor-architect", to: "actor-lead", message: "still alive" }),
  );
});

test("polling follows comment pages instead of silently truncating at 100", async (t) => {
  const { log } = await withAdapter(t, undefined, "pagination");
  assert.match(readFileSync(log, "utf8"), /after=CURSOR/);
});
