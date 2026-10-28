import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Runtime } from "../../.pi/extensions/hall-crew/crew-runtime/lib/runtime.mjs";

const piAvailable = () => spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0;

function crew(extra) {
  const namespace = `crew-${randomUUID()}`;
  const handle = "developer-probe-00";
  const agent = {
    name: handle, actorId: `${namespace}-${handle}`, role: "developer", task: "x", resident: true, initialTurn: "first-delivery",
    namespace, crewMembers: [handle], tools: ["read"], commTools: ["comm_notify"], ...extra,
  };
  return { agent, plan: { namespace, members: [{ handle, dependsOn: [], task: "x" }] } };
}

test("a worker that dies before it is ready fails the launch at once, not after the readiness timeout", async () => {
  // An unreachable Armory release makes worker.mjs exit while preparing, before Pi starts.
  const { agent, plan } = crew({ armory: { catalog: { release: "http://127.0.0.1:9/artifacts.json" }, requests: [{ suite: "collaboration/pi-github-tools", tools: ["github_issue_view"] }] } });
  const runtime = new Runtime(process.cwd());
  const started = Date.now();
  try {
    await assert.rejects(runtime.launchCrew([agent], [], plan, { readyTimeoutMs: 60_000 }), /exited before it was ready/);
    assert.ok(Date.now() - started < 15_000, `failed in ${Date.now() - started} ms, not by timeout`);
  } finally {
    await runtime.stop();
  }
});

test("a requested extension that fails to load fails the launch at once (Pi exits; the launch notices)", { skip: !piAvailable() && "pi is not installed" }, async () => {
  // An extension that exists but throws while loading: Pi reports it and keeps running.
  const dir = mkdtempSync(join(tmpdir(), "broken-extension-"));
  const broken = join(dir, "broken.mjs");
  writeFileSync(broken, 'throw new Error("sandbox extension failed to initialise");\n');
  const { agent, plan } = crew({ extensionPaths: [broken] });
  const runtime = new Runtime(process.cwd());
  const started = Date.now();
  try {
    await assert.rejects(runtime.launchCrew([agent], [], plan, { readyTimeoutMs: 60_000 }), /exited before it was ready/);
    assert.ok(Date.now() - started < 30_000, `took ${Date.now() - started} ms`);
    assert.equal(readdirSync(".pi/runtime/archive").filter((name) => name === agent.actorId).length, 1, "evidence was archived before rollback");
  } finally {
    await runtime.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(`.pi/runtime/archive/${agent.actorId}`, { recursive: true, force: true });
  }
});
