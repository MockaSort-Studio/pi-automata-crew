// createLiveLedgerTracker no longer depends on a same-process Runtime --
// it connects directly to a run's own Comm controller over WebSocket, as a
// dedicated observer actor distinct from "main" (see monitor-live-ledger.mjs's
// header for why). This harness spins up a real CommController and drives
// the tracker the same way a real, separate-process TUI session would:
// over the wire, with a second independent WS client publishing typed
// lifecycle updates. It also calls comm.registerPlan() itself, the
// same way Runtime.launchCrew() now does for a real run, so the server
// actually owns a ledger for this run's namespace before the tracker asks
// for a snapshot/subscription.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CommController } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-controller.mjs";
import { connectComm } from "../../.pi/extensions/hall-crew/crew-runtime/lib/comm-client.mjs";
import { createLiveLedgerTracker } from "../../.pi/extensions/hall-crew/crew/lib/monitor-live-ledger.mjs";

const selectedCrew = (runId = "run-1") => ({
  runId,
  members: [
    { name: "alpha", handle: "developer-alpha-00", task: "Do alpha work.", dependsOn: [] },
    { name: "bravo", handle: "developer-bravo-00", task: "Do bravo work.", dependsOn: ["developer-alpha-00"] },
  ],
});

const qualified = (runId, handle) => `crew-${runId}-${handle}`;

async function harness(runId = "run-1") {
  const comm = new CommController();
  for (const member of selectedCrew(runId).members) comm.registerActor(qualified(runId, member.handle));
  const port = await comm.start();
  const url = `ws://127.0.0.1:${port}`;
  const main = await connectComm({ url, actorId: "main" });
  await main.registerPlan(`crew-${runId}`, selectedCrew(runId).members);
  return {
    url,
    main,
    async close() {
      main.close();
      await comm.stop();
    },
  };
}

// Polls because the tracker's connection to the real Comm URL is
// necessarily asynchronous (a real WS handshake, not an in-process call).
async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("ledgerFor projects typed lifecycle updates from a run's real Comm URL", async () => {
  const { url, main, close } = await harness();
  try {
    const tracker = createLiveLedgerTracker();
    const ledger = tracker.ledgerFor(selectedCrew(), url);
    assert.equal(ledger.status("developer-alpha-00"), "waiting");

    await new Promise((resolve) => setTimeout(resolve, 200));
    const alphaClient = await connectComm({
      url,
      actorId: qualified("run-1", "developer-alpha-00"),
      namespace: "crew-run-1",
    });
    await alphaClient.lifecycleUpdate("crew-run-1", "running");
    await waitFor(() => ledger.status("developer-alpha-00") === "running");
    await alphaClient.lifecycleUpdate("crew-run-1", "complete");
    alphaClient.close();
    await waitFor(() => ledger.status("developer-alpha-00") === "complete");
    assert.equal(ledger.status("developer-bravo-00"), "ready");

    tracker.stop();
  } finally {
    await close();
  }
});

test("ledgerFor rebuilds and reconnects when the plan's runId changes", async () => {
  const first = await harness("run-1");
  const second = await harness("run-2");
  try {
    const tracker = createLiveLedgerTracker();
    const a = tracker.ledgerFor(selectedCrew("run-1"), first.url);
    const b = tracker.ledgerFor(selectedCrew("run-2"), second.url);
    assert.notEqual(a, b);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const alphaClient = await connectComm({
      url: second.url,
      actorId: qualified("run-2", "developer-alpha-00"),
      namespace: "crew-run-2",
    });
    await alphaClient.lifecycleUpdate("crew-run-2", "running");
    await waitFor(() => b.status("developer-alpha-00") === "running");
    // The first run's ledger must not have received the second run's envelope.
    assert.equal(a.status("developer-alpha-00"), "waiting");

    alphaClient.close();
    tracker.stop();
  } finally {
    await first.close();
    await second.close();
  }
});

test("ledgerFor tears down and returns undefined when there is no plan", () => {
  const tracker = createLiveLedgerTracker();
  tracker.ledgerFor(selectedCrew(), undefined);
  assert.equal(tracker.ledgerFor(null), undefined);
});

test("ledgerFor without a commUrl still returns a structural ledger (run not started yet)", () => {
  const tracker = createLiveLedgerTracker();
  const ledger = tracker.ledgerFor(selectedCrew());
  assert.equal(ledger.status("developer-alpha-00"), "waiting");
  tracker.stop();
});

test("stop() tears down the live connection: further server-side updates never reach a ledger already stopped", async () => {
  const { url, main, close } = await harness();
  try {
    const tracker = createLiveLedgerTracker();
    const ledger = tracker.ledgerFor(selectedCrew(), url);
    await new Promise((resolve) => setTimeout(resolve, 200));

    tracker.stop();

    const alphaClient = await connectComm({
      url,
      actorId: qualified("run-1", "developer-alpha-00"),
      namespace: "crew-run-1",
    });
    await alphaClient.lifecycleUpdate("crew-run-1", "running");
    alphaClient.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The facade handed out before stop() is read-only and frozen: it must
    // never observe an envelope emitted after teardown.
    assert.equal(ledger.status("developer-alpha-00"), "waiting");
  } finally {
    await close();
  }
});

test("a facade returned for an earlier run stays frozen once ledgerFor moves on to a new run (TUI never mutates a torn-down projection)", async () => {
  const first = await harness("run-1");
  try {
    const tracker = createLiveLedgerTracker();
    const stale = tracker.ledgerFor(selectedCrew("run-1"), first.url);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Same tracker, no commUrl this time: ledgerFor(null) tears the run down
    // (the "active roster disappeared" case a real TUI hits between polls).
    assert.equal(tracker.ledgerFor(null), undefined);

    const alphaClient = await connectComm({
      url: first.url,
      actorId: qualified("run-1", "developer-alpha-00"),
      namespace: "crew-run-1",
    });
    await alphaClient.lifecycleUpdate("crew-run-1", "running");
    alphaClient.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(stale.status("developer-alpha-00"), "waiting");
  } finally {
    await first.close();
  }
});
