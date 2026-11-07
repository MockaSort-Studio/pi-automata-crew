import { strict as assert } from "node:assert";
import test from "node:test";
import { createHostCore } from "../../extensions/crew/runner/host-core.mjs";

const A = "developer-alpha-00";
const B = "developer-bravo-00";
const member = (handle, extra = {}) => ({
  handle,
  task: `do ${handle}`,
  tools: ["read"],
  suiteGrants: [],
  dependsOn: [],
  ...extra,
});
const done = (extra = {}) => ({ status: "completed", finalText: "ok", usage: {}, evidence: {}, ...extra });

function host({ results = {}, deps = {} } = {}) {
  const sent = [];
  const created = [];
  const disposed = [];
  const core = createHostCore({
    send: (message) => sent.push(message),
    deps: {
      env: { HALL_GITHUB_TOKEN: "secret-token-xyz" },
      cwd: "/repo",
      createModelRuntime: async () => ({ name: "runtime" }),
      resolveModel: (_runtime, model) => {
        if (model !== "mock/mock-model") throw new Error(`Model "${model}" was not found in Pi's model catalog.`);
      },
      buildSeed: () => Buffer.from("seed"),
      loadGithubModule: async () => ({ activateSuite() {} }),
      createMemberAgent: async ({ member: m, crew, onEvent }) => {
        created.push({ handle: m.handle, crew });
        onEvent(m.handle, { type: "tool_start", name: "read" });
        return {
          run: { prompt: async () => results[m.handle] ?? done(), abort: async () => {} },
          dispose: async () => disposed.push(m.handle),
        };
      },
      ...deps,
    },
  });
  const call = async (method, params) => {
    const id = sent.length + 1000;
    await core.handle({ id, method, params });
    return sent.find((m) => m.id === id);
  };
  return { core, sent, created, disposed, call };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const launch = (extra = {}) => ({ runId: "run1", crewDir: "/tmp/crew", members: [member(A)], ...extra });
const events = (sent, name) => sent.filter((m) => m.event === name);

test("everything that can be known up front is validated before any agent or VM exists", async () => {
  const cases = [
    [{ members: [] }, /at least one member/],
    [{ members: [member("Not A Handle")] }, /Invalid member handle/],
    [{ members: [member(A), member(A)] }, /already exists/],
    [{ members: [member(A, { dependsOn: [B] })] }, /Unknown dependency ledger node/],
    [{ members: [member(A, { dependsOn: [B] }), member(B, { dependsOn: [A] })] }, /cycle/],
    [{ members: [member(A, { model: "no-such/model" })] }, /developer-alpha-00: Model "no-such\/model" was not found/],
    [
      {
        members: [member(A, { model: "inherit" })],
        deps: {
          resolveModel: () => {
            throw new Error('"inherit" and "default" are not model IDs.');
          },
        },
      },
      /not model IDs/,
    ],
  ];
  for (const [params, pattern] of cases) {
    const { call, created, sent } = host({ deps: params.deps });
    const response = await call("launch", launch(params));
    assert.equal(response.ok, false, JSON.stringify(params.members.map((m) => m.handle)));
    assert.match(response.error.message, pattern);
    assert.deepEqual(created, [], "no agent was created");
    assert.deepEqual(events(sent, "result"), []);
  }
});

test("an unavailable repository revision, a missing credential and a missing cache fail the launch before any agent", async () => {
  const github = [{ suite: "collaboration/pi-github-tools", operations: ["github_git_push"] }];
  const bad = host({
    deps: {
      buildSeed: () => {
        throw new Error("Authorized repository revision is unavailable for the worker workspace");
      },
    },
  });
  assert.match(
    (await bad.call("launch", launch({ repository: { repo: "o/r", revision: "a".repeat(40), base: "main" } }))).error
      .message,
    /revision is unavailable/,
  );
  const noToken = host({ deps: { env: {} } });
  assert.match(
    (await noToken.call("launch", launch({ members: [member(A, { suiteGrants: github })] }))).error.message,
    /no Crew credential/,
  );
  const noCache = host({
    deps: {
      resolveDependencyCache: () => {
        throw new Error("Repository dependency cache abc is unavailable.");
      },
    },
  });
  assert.match(
    (await noCache.call("launch", launch({ environment: { dependencyCache: "required", guestProfile: "p" } }))).error
      .message,
    /cache abc is unavailable/,
  );
  for (const h of [bad, noToken, noCache]) assert.deepEqual(h.created, []);
});

test("a valid launch starts the crew, forwards results and states tagged with the run, and tracks activity", async () => {
  const h = host({ results: { [A]: done({ finalText: "alpha result" }) } });
  const response = await h.call("launch", launch({ members: [member(A), member(B, { dependsOn: [A] })] }));
  assert.equal(response.ok, true);
  assert.deepEqual(
    response.result.members.map((m) => m.handle),
    [A, B],
  );
  await settle();
  assert.deepEqual(
    events(h.sent, "result").map((m) => [m.runId, m.handle, m.result.status]),
    [
      ["run1", A, "completed"],
      ["run1", B, "completed"],
    ],
  );
  assert.ok(events(h.sent, "state").some((m) => m.handle === B && m.state === "running"));
  assert.ok(events(h.sent, "idle").length >= 1);
  const status = (await h.call("status", { runId: "run1" })).result;
  assert.deepEqual(
    status.members.map((m) => m.state),
    ["completed", "completed"],
  );
  assert.equal(status.members[0].lastActivity.name, "read");
  assert.deepEqual((await h.call("list", {})).result, { crews: ["run1"] });
});

test("the crew context given to each agent carries the seed, the repository and the Crew credential only to the suite", async () => {
  const github = [{ suite: "collaboration/pi-github-tools", operations: ["github_git_push"] }];
  const repository = { repo: "o/r", revision: "a".repeat(40), base: "main" };
  const h = host();
  await h.call("launch", launch({ repository, members: [member(A, { suiteGrants: github })], idleMs: 5 }));
  await settle();
  const { crew } = h.created[0];
  assert.equal(crew.runId, "run1");
  assert.deepEqual(crew.repository, repository);
  assert.equal(crew.seedArchive.toString(), "seed");
  assert.equal(crew.github.token, "secret-token-xyz");
  assert.equal(crew.idleMs, 5);
});

test("secrets never leave the host: errors and results are scrubbed", async () => {
  const h = host({
    deps: {
      createMemberAgent: async () => {
        throw new Error("boom with secret-token-xyz inside");
      },
    },
  });
  await h.call("launch", launch());
  await settle();
  const [result] = events(h.sent, "result");
  assert.equal(result.result.failure.category, "startup_error");
  assert.doesNotMatch(JSON.stringify(h.sent), /secret-token-xyz/);
  const failing = host({
    deps: {
      buildSeed: () => {
        throw new Error("cannot reach with secret-token-xyz");
      },
    },
  });
  const response = await failing.call(
    "launch",
    launch({ repository: { repo: "o/r", revision: "a".repeat(40), base: "main" } }),
  );
  assert.doesNotMatch(response.error.message, /secret-token-xyz/);
  assert.match(response.error.message, /\[redacted\]/);
});

test("message, cancel and dispose are routed to the right crew; unknown ones are errors", async () => {
  const h = host({
    results: { [A]: { status: "needs_input", question: "which?", finalText: "", usage: {}, evidence: {} } },
  });
  await h.call("launch", launch());
  await settle();
  assert.equal((await h.call("message", { runId: "run1", handle: A, text: "x" })).ok, true);
  assert.equal((await h.call("message", { runId: "nope", handle: A, text: "x" })).ok, false);
  assert.match(
    (await h.call("message", { runId: "run1", handle: "nobody-x-00", text: "x" })).error.message,
    /Unknown member/,
  );
  assert.equal((await h.call("cancel", { runId: "run1", handle: A })).ok, true);
  assert.equal((await h.call("dispose", { runId: "run1" })).ok, true);
  assert.deepEqual(h.disposed, [A]);
  assert.match((await h.call("status", { runId: "run1" })).error.message, /Unknown crew/);
  assert.match((await h.call("nonsense", {})).error.message, /Unknown method/);
});

test("closing the host disposes every crew's agents", async () => {
  const h = host();
  await h.call("launch", launch({ runId: "r1" }));
  await h.call("launch", launch({ runId: "r2", members: [member(B)] }));
  await settle();
  await h.core.close();
  assert.deepEqual(h.disposed.sort(), [A, B]);
  assert.deepEqual((await h.call("list", {})).result, { crews: [] });
});

test("status carries live per-member totals that grow as the agent works, before it reports", async () => {
  let report;
  const h = host({
    deps: {
      createMemberAgent: async ({ member: m, onEvent }) => ({
        run: {
          prompt: () =>
            new Promise((resolve) => {
              onEvent(m.handle, { type: "tool_start", name: "bash" });
              onEvent(m.handle, { type: "tool_end", name: "bash", error: true });
              onEvent(m.handle, { type: "turn", usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 1 } });
              onEvent(m.handle, { type: "turn", usage: { input: 50, output: 10 } });
              report = () => resolve(done());
            }),
          abort: async () => {},
        },
        dispose: async () => {},
      }),
    },
  });
  await h.call("launch", launch());
  await settle();
  const [running] = (await h.call("status", { runId: "run1" })).result.members;
  assert.equal(running.state, "running");
  assert.deepEqual(running.live, {
    turns: 2,
    toolCalls: 1,
    toolErrors: 1,
    input: 150,
    output: 30,
    cacheRead: 5,
    cacheWrite: 1,
  });
  report();
});

test("a malformed suite grant fails the launch instead of silently granting nothing", async () => {
  const h = host();
  const github = "collaboration/pi-github-tools";
  for (const grant of [
    { suite: github, tools: ["github_issue_view"] },
    { suite: github, operations: [] },
    { operations: ["x"] },
  ]) {
    const reply = await h.call("launch", launch({ members: [member(A, { suiteGrants: [grant] })] }));
    assert.match(reply.error.message, /developer-alpha-00: a suite grant needs a suite and a list of operations/);
  }
  assert.deepEqual(h.created, [], "no agent was created");
});
