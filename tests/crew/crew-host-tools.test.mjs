import { strict as assert } from "node:assert";
import test from "node:test";
import { registerCrewHostTools } from "../../extensions/crew/crew/lib/crew-host-tools.ts";

function setup() {
  const tools = new Map();
  const requests = [];
  const runs = new Set(["run1", "run2"]);
  const crew = {
    client: () => ({ request: async (method, params) => (requests.push([method, params]), { method, ...params }) }),
    runs: () => [...runs],
    untrack: (runId) => runs.delete(runId),
  };
  registerCrewHostTools({ registerTool: (tool) => tools.set(tool.name, tool) }, () => crew);
  const call = async (name, input) =>
    JSON.parse((await tools.get(name).execute("id", input, undefined, undefined, {})).content[0].text);
  return { tools, requests, call, runs };
}

test("Main can look at, answer, cancel and clean up crews", async () => {
  const { tools, requests, call, runs } = setup();
  assert.deepEqual([...tools.keys()].sort(), [
    "crew_cancel",
    "crew_handoff",
    "crew_hold",
    "crew_message",
    "crew_status",
    "runtime_cleanup",
    "runtime_dispatch",
  ]);
  assert.equal((await call("crew_status", { runId: "run1" })).length, 1);
  assert.equal((await call("crew_status", {})).length, 2, "without a run id: every crew started from this session");
  await call("crew_message", { runId: "run1", member: "developer-a-00", text: "src/x.txt" });
  assert.deepEqual(requests.at(-1), ["message", { runId: "run1", handle: "developer-a-00", text: "src/x.txt" }]);
  await call("crew_cancel", { runId: "run1", member: "developer-a-00" });
  assert.deepEqual(requests.at(-1), ["cancel", { runId: "run1", handle: "developer-a-00" }]);
  await call("crew_cancel", { runId: "run1" });
  assert.deepEqual(requests.at(-1), ["cancel", { runId: "run1", handle: undefined }], "no member means the whole crew");
  assert.deepEqual(await call("runtime_cleanup", {}), { disposed: ["run1", "run2"] });
  assert.deepEqual([...runs], [], "cleanup forgets the crews it disposed");
});

test("Main can hold a member without a turn and hand off unaccepted work, each routed as its own request", async () => {
  const { call, requests, tools } = setup();
  const refs = { pullRequest: "https://github.com/o/r/pull/9", head: "a".repeat(40) };
  await call("crew_hold", {
    runId: "run1",
    member: "developer-a-00",
    blocker: "PR #9",
    owner: "human",
    resumeWhen: "merged",
    refs,
  });
  assert.deepEqual(requests.at(-1), [
    "hold",
    { runId: "run1", handle: "developer-a-00", blocker: "PR #9", owner: "human", resumeWhen: "merged", refs },
  ]);
  for (const name of ["crew_hold", "crew_status"])
    assert.match(tools.get(name).description, /Main-asserted/, `${name} says hold refs are Main's own claims`);
  await call("crew_handoff", { runId: "run1", member: "developer-a-00", unmet: ["green CI"] });
  assert.deepEqual(requests.at(-1), [
    "handoff",
    { runId: "run1", handle: "developer-a-00", unmet: ["green CI"], supersededBy: undefined, note: undefined },
  ]);
  assert.equal(requests.filter(([method]) => method === "message").length, 0, "neither one resumes the member");
});

test("the old dispatch call is a harmless no-op, because start_crew dispatches", async () => {
  const { call, requests } = setup();
  assert.equal((await call("runtime_dispatch", { runId: "run1", idempotencyKey: "k" })).dispatched, true);
  assert.deepEqual(requests, []);
});
