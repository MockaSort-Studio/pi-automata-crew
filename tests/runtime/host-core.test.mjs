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
      prepareDependencySources: async () => ({ snapshots: [], failures: [] }),
      resolveArmoryCatalog: async () => ({ revision: "abc" }),
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

test("direct host requirements cannot bypass grants or create a model runtime", async () => {
  let runtimes = 0;
  const h = host({
    deps: {
      createModelRuntime: async () => {
        runtimes++;
        return {};
      },
    },
  });
  const response = await h.call(
    "launch",
    launch({
      members: [
        member(A, {
          requiredCapabilities: [{ suite: "system", operations: ["bash"] }],
        }),
      ],
    }),
  );
  assert.equal(response.ok, false);
  assert.match(response.error.message, /developer-alpha-00.*system.*bash.*missing grant/);
  assert.equal(runtimes, 0);
  assert.deepEqual(h.created, []);
});

test("raw host rejects malformed native tools and duplicate suite grants before external creation", async () => {
  const suite = "collaboration/pi-github-tools";
  for (const extra of [
    { tools: "bash", requiredCapabilities: [{ suite: "system", operations: ["bash"] }] },
    { tools: "readedit", requiredCapabilities: [{ suite: "system", operations: ["edit"] }] },
    { tools: ["read", "not-a-tool"] },
    {
      suiteGrants: [
        { suite, operations: ["github_git_status"] },
        { suite, operations: ["github_issue_view"] },
      ],
      requiredCapabilities: [{ suite, operations: ["github_issue_view"] }],
    },
  ]) {
    let external = 0;
    const h = host({
      deps: {
        createModelRuntime: async () => {
          external++;
          return {};
        },
      },
    });
    const response = await h.call("launch", launch({ members: [member(A, extra)] }));
    assert.equal(response.ok, false);
    assert.match(response.error.message, /developer-alpha-00/);
    assert.equal(external, 0);
    assert.deepEqual(h.created, []);
  }
});

test("an unavailable repository revision and a missing credential fail the launch before any agent", async () => {
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
  for (const h of [bad, noToken]) assert.deepEqual(h.created, []);
});

test("launch reports source prerequisites without exposing source bytes", async () => {
  const h = host({
    deps: {
      prepareDependencySources: async () => ({
        snapshots: [{ secret: "never-report" }],
        failures: ["prettier unavailable"],
      }),
    },
  });
  const result = await h.call("launch", launch({ members: [member(A, { tools: ["bash"] })] }));
  assert.equal(result.ok, true);
  assert.match(result.result.warnings.join(" "), /prettier unavailable/);
  assert.doesNotMatch(JSON.stringify(result.result), /never-report/);
  await h.core.close();
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

test("hold and handoff are Main's recorded decisions: no turn, no report, dependents stay held", async () => {
  let prompts = 0;
  const created = [];
  const h = host({
    deps: {
      createMemberAgent: async ({ member: m }) => {
        created.push(m.handle);
        return {
          run: {
            prompt: async () => (prompts++, { status: "needs_input", question: "?", finalText: "", evidence: {} }),
            abort: async () => {},
          },
          dispose: async () => h.disposed.push(m.handle),
        };
      },
    },
  });
  await h.call("launch", launch({ members: [member(A), member(B, { dependsOn: [A] })] }));
  await settle();
  const held = await h.call("hold", {
    runId: "run1",
    handle: A,
    blocker: "waiting on secret-token-xyz rotation",
    owner: "human",
    resumeWhen: "token rotated",
  });
  assert.equal(held.ok, true);
  assert.equal(held.result.hold.owner, "human");
  assert.doesNotMatch(JSON.stringify(h.sent), /secret-token-xyz/);
  await settle();
  assert.equal(prompts, 1, "the hold started no turn");
  assert.equal(events(h.sent, "result").length, 1, "and is not a report");
  const [decision] = events(h.sent, "decision");
  assert.deepEqual([decision.runId, decision.handle, decision.decision.type], ["run1", A, "hold"]);
  let [first, second] = (await h.call("status", { runId: "run1" })).result.members;
  assert.deepEqual([first.state, first.hold.resumeWhen, first.lastReport.current], ["on_hold", "token rotated", false]);
  assert.equal(second.state, "held");

  const handed = await h.call("handoff", { runId: "run1", handle: A, unmet: ["green CI"] });
  assert.deepEqual([handed.ok, handed.result.handoff.outcome], [true, "partial"]);
  assert.deepEqual(h.disposed, [A], "its VM was released");
  [first, second] = (await h.call("status", { runId: "run1" })).result.members;
  assert.deepEqual([first.state, first.ledger, first.handoff.unmet], ["handed_off", "blocked", ["green CI"]]);
  assert.equal(second.state, "held");
  assert.deepEqual(created, [A], "the dependent never started");
  assert.match((await h.call("hold", { runId: "run1", handle: A })).error.message, /handed_off/);
  assert.match((await h.call("handoff", { runId: "nope", handle: A, unmet: ["x"] })).error.message, /Unknown crew/);
});

test("a launch resolving after close is rejected and its runtime is disposed", async () => {
  let release;
  let disposed = 0;
  const h = host({ deps: { createModelRuntime: () => new Promise((resolve) => (release = resolve)) } });
  const pending = h.call("launch", launch());
  await h.core.close();
  release({ dispose: async () => (disposed += 1) });
  const response = await pending;
  assert.equal(response.ok, false);
  assert.match(response.error.message, /clos/i);
  assert.equal(disposed, 1);
  assert.deepEqual(h.created, []);
  assert.deepEqual((await h.call("list", {})).result, { crews: [] });
  assert.equal((await h.call("launch", launch())).ok, false);
});

test("closing while the GitHub catalog resolves prevents module loading and registration", async () => {
  let release;
  let arrived;
  let disposed = 0;
  let loads = 0;
  const entered = new Promise((resolve) => (arrived = resolve));
  const h = host({
    deps: {
      createModelRuntime: async () => ({ dispose: async () => (disposed += 1) }),
      resolveArmoryCatalog: () => {
        arrived();
        return new Promise((resolve) => (release = resolve));
      },
      loadGithubModule: async () => {
        loads += 1;
        return { activateSuite() {} };
      },
    },
  });
  const github = [{ suite: "collaboration/pi-github-tools", operations: ["github_issue_view"] }];
  const pending = h.call("launch", launch({ members: [member(A, { suiteGrants: github })] }));
  await entered;
  await h.core.close();
  release({ revision: "abc" });
  const response = await pending;
  assert.equal(response.ok, false);
  assert.match(response.error.message, /clos/i);
  assert.equal(loads, 0);
  assert.equal(disposed, 1);
  assert.deepEqual(h.created, []);
  assert.deepEqual(events(h.sent, "state"), [{ event: "state", runId: "run1", handle: A, state: "cancelled" }]);
  assert.deepEqual((await h.call("list", {})).result, { crews: [] });
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
    compactions: 0,
    context: null,
  });
  report();
});

test("status counts completed compaction events per member", async () => {
  const emit = new Map();
  const h = host({
    deps: {
      createMemberAgent: async ({ member: m, onEvent }) => {
        emit.set(m.handle, (event) => onEvent(m.handle, event));
        return { run: { prompt: () => new Promise(() => {}), abort: async () => {} }, dispose: async () => {} };
      },
    },
  });
  await h.call("launch", launch({ members: [member(A), member(B)] }));
  await settle();
  const counts = async () => (await h.call("status", { runId: "run1" })).result.members.map((m) => m.live.compactions);
  assert.deepEqual(await counts(), [0, 0]);
  emit.get(A)({ type: "compaction" });
  assert.deepEqual(await counts(), [1, 0]);
  emit.get(A)({ type: "compaction" });
  emit.get(B)({ type: "compaction" });
  assert.deepEqual(await counts(), [2, 1]);
});

test("status reports the latest context and retains a known percent across compaction", async () => {
  let emit;
  const h = host({
    deps: {
      createMemberAgent: async ({ member: m, onEvent }) => {
        emit = (event) => onEvent(m.handle, event);
        return { run: { prompt: () => new Promise(() => {}), abort: async () => {} }, dispose: async () => {} };
      },
    },
  });
  await h.call("launch", launch());
  await settle();
  const context = async () => (await h.call("status", { runId: "run1" })).result.members[0].live.context;
  assert.equal(await context(), null);
  emit({ type: "turn", context: { percent: null, contextWindow: 1000 } });
  assert.deepEqual(await context(), { percent: null, window: 1000 });
  emit({ type: "turn", context: { percent: 25.5, contextWindow: 1000 } });
  assert.deepEqual(await context(), { percent: 25.5, window: 1000 });
  emit({ type: "turn", context: { percent: 12, contextWindow: 2000 } });
  assert.deepEqual(await context(), { percent: 12, window: 2000 });
  emit({ type: "turn", context: { percent: null, contextWindow: 3000 } });
  assert.deepEqual(await context(), { percent: 12, window: 3000 });
  emit({ type: "turn" });
  assert.deepEqual(await context(), { percent: 12, window: 3000 });
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

test("a persona whose name contains hyphens can launch, while a malformed handle is still refused", async () => {
  const h = host();
  const ok = await h.call(
    "launch",
    launch({ members: [member("reviewer-indiana-docs-00"), member("lead-old-major-00")] }),
  );
  assert.deepEqual(
    ok.result.members.map((m) => m.handle),
    ["reviewer-indiana-docs-00", "lead-old-major-00"],
  );
  for (const bad of ["indiana-docs", "reviewer--docs-00", "reviewer-docs-0", "Reviewer-docs-00", "reviewer-9docs-00"]) {
    const reply = await h.call("launch", launch({ runId: `r-${bad}`, members: [member(bad)] }));
    assert.match(reply.error.message, /Invalid member handle/, bad);
  }
});

test("host launch reports cached catalog revision and timestamp", async () => {
  const github = [{ suite: "collaboration/pi-github-tools", operations: ["github_issue_view"] }];
  const h = host({
    deps: {
      resolveArmoryCatalog: async () => ({ revision: "abc", fromCache: true, cachedAt: "2026-01-01T00:00:00Z" }),
    },
  });
  const response = await h.call("launch", launch({ members: [member(A, { suiteGrants: github })] }));
  assert.equal(response.ok, true);
  assert.match(response.result.warnings.join(" "), /cached.*abc.*2026-01-01/);
  await h.core.close();
});

test("two concurrent launches of one run id: only the first starts a crew", { timeout: 5000 }, async () => {
  const pending = [];
  const h = host({ deps: { createModelRuntime: () => new Promise((resolve) => pending.push(resolve)) } });
  const first = h.core.handle({ id: 1, method: "launch", params: launch() });
  const second = h.core.handle({ id: 2, method: "launch", params: launch() });
  await settle();
  for (const resolve of pending) resolve({});
  await Promise.all([first, second]);
  const replies = [1, 2].map((id) => h.sent.find((m) => m.id === id));
  assert.deepEqual(
    replies.map((reply) => reply.ok),
    [true, false],
  );
  assert.match(replies[1].error.message, /already exists/);
  assert.equal(pending.length, 1, "the second launch built nothing");
  await settle();
  assert.deepEqual(
    h.created.map((c) => c.handle),
    [A],
  );
  assert.deepEqual((await h.call("list", {})).result, { crews: ["run1"] });
});
