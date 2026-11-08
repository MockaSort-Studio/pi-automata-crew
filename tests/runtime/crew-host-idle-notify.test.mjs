import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { bindCrewHost, crewHost } from "../../extensions/crew/crew/lib/crew-host.mjs";
import { buildAutomataTab } from "../../extensions/crew/crew/lib/monitor-dashboard.mjs";
import { crewView } from "../../extensions/crew/crew/lib/crew-view.mjs";
import { createHostCore } from "../../extensions/crew/runner/host-core.mjs";

// The real path from the dispatcher's idle event, through the host core and Main's crew host, to the terminal
// notifier: a member Main already held or handed off must not bring a "waiting for input" turn back to Main.
const A = "developer-alpha-00";
const B = "developer-bravo-00";
const C = "developer-charlie-00";
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  const holder = globalThis.__piCrewHost;
  if (holder)
    Object.assign(holder, { client: undefined, pi: undefined, notifier: undefined, runs: new Map(), plans: new Map() });
});

// A asks Main a question; everyone else completes.
const outcome = (handle) =>
  handle === A
    ? { status: "needs_input", question: "which?", finalText: "", evidence: {} }
    : { status: "completed", finalText: "done", evidence: {} };

function crew(t, members) {
  const cwd = mkdtempSync(join(tmpdir(), "crew-idle-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const sent = [];
  bindCrewHost({ sendMessage: (message, options) => sent.push({ message, options }) });
  let onEvent;
  const createClient = (options) => {
    onEvent = options.onEvent;
    return { request: async () => ({}), stop: async () => {} };
  };
  crewHost({ cwd, configDir: ".pi", createClient }).client();
  const gates = new Map();
  const replies = new Map();
  const core = createHostCore({
    send: (message) => (message.id === undefined ? onEvent(message) : replies.set(message.id, message)),
    deps: {
      env: {},
      cwd,
      createModelRuntime: async () => ({}),
      resolveModel: () => {},
      createMemberAgent: async ({ member }) => ({
        run: {
          prompt: async () => {
            await gates.get(member.handle);
            return outcome(member.handle);
          },
          abort: async () => {},
        },
        dispose: async () => {},
      }),
    },
  });
  t.after(() => core.close());
  let id = 0;
  const call = async (method, params) => {
    id += 1;
    await core.handle({ id, method, params: { runId: "run1", ...params } });
    const reply = replies.get(id);
    assert.equal(reply.ok, true, reply.error?.message);
    return reply.result;
  };
  const gate = (handle) => {
    let release;
    gates.set(handle, new Promise((resolve) => (release = resolve)));
    return release;
  };
  const launch = () =>
    call("launch", {
      crewDir: cwd,
      members: members.map(([handle, dependsOn = []]) => ({ handle, task: handle, tools: [], dependsOn })),
    });
  const terminal = () => sent.filter(({ message }) => message.customType === "crew-terminal");
  return { call, gate, launch, terminal };
}

test("a held member does not bring back a waiting-for-input turn when the rest of the crew settles", async (t) => {
  const c = crew(t, [[A], [C]]);
  const releaseC = c.gate(C);
  await c.launch();
  await settle();
  assert.deepEqual(c.terminal(), [], "C still works: the crew has not settled");
  await c.call("hold", { handle: A, blocker: "PR #9", owner: "human", resumeWhen: "PR #9 merged" });
  releaseC();
  await settle();
  const [notice] = c.terminal();
  assert.ok(notice, "Main is still told the crew settled");
  assert.doesNotMatch(notice.message.content, /waiting for input/);
  assert.deepEqual(notice.options, { triggerTurn: false }, "without a Main turn");
});

test("a handed-off member and its held dependent read as handed off and blocked, and ask Main nothing", async (t) => {
  const c = crew(t, [[A], [B, [A]]]);
  await c.launch();
  await settle();
  const before = c.terminal().length;
  await c.call("handoff", { handle: A, unmet: ["green CI"] });
  await settle();
  assert.equal(c.terminal().length, before, "a handoff starts no notification");
  const { members } = await c.call("status", {});
  assert.deepEqual(
    members.map((m) => [m.state, m.ledger]),
    [
      ["handed_off", "blocked"],
      ["held", "blocked"],
    ],
  );
  const view = crewView({ runId: "run1", members });
  assert.equal(view.line.view.phase, "Handed off");
  assert.deepEqual(
    buildAutomataTab(view.snapshot).map((row) => row.bucket),
    ["blocked", "blocked"],
  );
});
