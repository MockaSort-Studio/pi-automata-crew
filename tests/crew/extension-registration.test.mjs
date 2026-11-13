import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../extensions/crew/crew/index.ts", import.meta.url), "utf8");

test("crew extension is wired to the crew host, not to the earlier runtime", () => {
  assert.match(source, /import.*registerCrewHostTools.*from.*crew-host-tools/);
  assert.match(source, /import.*launchOnHost.*from.*host-launch/);
  assert.match(source, /import.*bindCrewHost.*from.*crew-host/);
  // Comm, Lifecycle, the monitor and the roster tools belong to the earlier runtime: kept, not loaded.
  for (const old of [
    /runtimeFor/,
    /shared-runtime/,
    /registerCrewMonitor/,
    /registerRosterTools/,
    /registerTerminalNotifierSession/,
    /launchPreparedCrew/,
  ])
    assert.doesNotMatch(source, old);
});

test("the package entry point loads Crew only, not the earlier runtime", () => {
  const entry = readFileSync(new URL("../../extensions/crew.ts", import.meta.url), "utf8");
  assert.match(entry, /import crew from/);
  assert.doesNotMatch(entry, /^import .*crew-runtime/m);
  assert.doesNotMatch(entry, /runtime\(pi\)/);
});

test("start_crew schema exposes the bounded microVM environment contract", () => {
  assert.match(source, /environment: Type\.Optional\(\s*Type\.Object\(/);
  for (const value of ["auto", "gondolin"]) assert.match(source, new RegExp(`Type\\.Literal\\("${value}"\\)`));
});

test("the extension wires session shutdown to stopHostOnQuit (its behavior is tested in crew-host.test.mjs)", () => {
  assert.match(
    source,
    /pi\.on\("session_shutdown", \(event: any, ctx: any\) => stopHostOnQuit\(event, host\(ctx\)\)\)/,
  );
  assert.match(source, /bindCrewHost\(pi\)/);
});

test("Crew assembly preview is a TUI-only entry before runtime launch, not a Main message", () => {
  assert.match(source, /registerCrewAssemblyCard\(pi\)/);
  assert.match(source, /pi\.appendEntry\(CREW_ASSEMBLED_ENTRY, assemblyCardData\(prepared, input\)\)/);
  assert.ok(source.indexOf("pi.appendEntry(CREW_ASSEMBLED_ENTRY") < source.indexOf("launchOnHost({"));
  assert.doesNotMatch(source, /sendMessage\([^)]*CREW_ASSEMBLED_ENTRY/);
});

test("crew extension registers the host tools", () => {
  assert.doesNotMatch(source, /registerCommunicationTools\(pi\)/);
  assert.match(source, /registerCrewHostTools\(pi, host\)/);
});

test("start_crew no longer renders a redundant final success line", () => {
  assert.doesNotMatch(source, /Crew started/);
  assert.match(source, /Launching crew\.\.\./, "the transient launch indication should remain");
  assert.match(source, /Crew launch failed/, "the error case should still render");
});

test("crew extension registers a Markdown renderer for incoming crew-message deliveries", () => {
  assert.match(source, /import.*registerCrewMessageRenderer.*from.*crew-message-renderer/);
  assert.match(source, /registerCrewMessageRenderer\(pi\)/);
});

test("Main keeps its footer and dashboard, fed by the crew host", () => {
  assert.match(source, /import.*registerHostMonitor.*from.*host-monitor/);
  assert.match(source, /monitor\.activate\(ctx\)/);
  const monitor = readFileSync(new URL("../../extensions/crew/crew/lib/host-monitor.ts", import.meta.url), "utf8");
  assert.match(monitor, /crew\.peek\(\)/, "polling never starts a host");
  assert.match(monitor, /request\("status"/);
  assert.match(monitor, /registerCrewDashboardCommand/);
  assert.match(monitor, /ctx\.mode !== "tui"/);
});

test("the doctor is a command and a tool", () => {
  assert.match(source, /registerCrewDoctor\(pi\)/);
  const doctor = readFileSync(new URL("../../extensions/crew/crew/lib/crew-doctor.ts", import.meta.url), "utf8");
  assert.match(doctor, /registerCommand\("crew-doctor"/);
  assert.match(doctor, /name: "crew_doctor"/);
});
