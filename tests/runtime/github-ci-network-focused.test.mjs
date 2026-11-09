import { test } from "node:test";
import assert from "node:assert/strict";
import { githubCiRequestAllowed, githubCiHeadersAllowed } from "../../extensions/crew/runner/github-ci-network.mjs";

const grants = ["github_workflow_runs_list", "github_workflow_run_view"];
const check = (url, options = {}, ops = grants) =>
  githubCiRequestAllowed(new Request(url, options), { repo: "Owner/Repo", operations: ops });
const base = "https://api.github.com/repos/Owner/Repo/actions";
test("CI metadata policy binds exact repo, methods, endpoints, grants and bounded queries", () => {
  for (const path of ["/runs", "/runs?per_page=100&page=1", "/runs/123", "/runs/123/jobs", "/jobs/456"])
    assert.equal(check(base + path), true, path);
  for (const url of [
    base + "/runs/1/logs",
    base + "/jobs/1/logs",
    base + "/runs?access_token=x",
    base + "/runs?per_page=101",
    base + "/runs?page=0",
    base + "/runs?per_page=1&per_page=2",
    base + "/runs/%31",
    base.replace("Owner/Repo", "owner/repo") + "/runs",
    base.replace("Owner/Repo", "other/repo") + "/runs",
    base.replace("api.github.com", "evil.example") + "/runs",
  ])
    assert.equal(check(url), false, url);
  assert.equal(check(base + "/runs", { method: "POST" }), false);
  assert.equal(check(base + "/runs", {}, ["github_workflow_run_view"]), false);
  assert.equal(check(base + "/runs/1", {}, ["github_workflow_runs_list"]), false);
  assert.equal(check(base + "/runs", {}, []), false);
});

test("logs and artifacts stay host-side: no guest grant opens their endpoints", () => {
  const all = [...grants, "github_workflow_run_failed_log"];
  for (const path of [
    "/runs/1/logs",
    "/jobs/1/logs",
    "/runs/1/attempts/1/logs",
    "/runs/1/artifacts",
    "/artifacts",
    "/artifacts/1",
    "/artifacts/1/zip",
  ])
    assert.equal(check(base + path, {}, all), false, path);
  // The failed-log grant is a host-side operation; it adds no guest egress on its own.
  for (const path of ["/runs", "/runs/1", "/runs/1/jobs", "/jobs/1"])
    assert.equal(check(base + path, {}, ["github_workflow_run_failed_log"]), false, path);
});

test("missing or malformed network policy fails closed", () => {
  const request = new Request(base + "/runs");
  for (const policy of [undefined, {}, { repo: "Owner/Repo" }, { repo: "Owner/Repo", operations: null }])
    assert.equal(githubCiRequestAllowed(request, policy), false);
});

test("only exact placeholder authorization is accepted before substitution", () => {
  const headers = (value, extra = {}) => new Headers({ authorization: value, ...extra });
  assert.equal(githubCiHeadersAllowed(headers("Bearer PLACEHOLDER"), "PLACEHOLDER"), true);
  assert.equal(githubCiHeadersAllowed(headers("Bearer REAL_TOKEN"), "PLACEHOLDER"), false);
  assert.equal(
    githubCiHeadersAllowed(headers("Bearer PLACEHOLDER", { "x-test": "PLACEHOLDER" }), "PLACEHOLDER"),
    false,
  );
  assert.equal(githubCiHeadersAllowed(new Headers(), "PLACEHOLDER"), false);
});
