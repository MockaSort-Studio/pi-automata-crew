import { strict as assert } from "node:assert";
import test from "node:test";
import { registerTerminalNotifierSession } from "../../.pi/extensions/hall-crew/crew/lib/terminal-notifier-session.mjs";

test("session binding forwards terminal notifications to Pi and tears down", () => {
  const handlers = new Map(),
    messages = [];
  let detachCount = 0,
    notify;
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    sendMessage: (message, options) => messages.push({ message, options }),
  };
  const runtimeFor = (cwd) => {
    assert.equal(cwd, "/repo");
    return {
      attachTerminalNotifier: (send) => {
        notify = send;
        return () => detachCount++;
      },
      attachMainDelivery: () => () => detachCount++,
    };
  };

  registerTerminalNotifierSession(pi, runtimeFor);
  handlers.get("session_start")({}, { cwd: "/repo" });
  notify({ customType: "crew-terminal", content: "done" }, { triggerTurn: true, deliverAs: "followUp" });
  assert.deepEqual(messages, [
    {
      message: { customType: "crew-terminal", content: "done" },
      options: { triggerTurn: true, deliverAs: "followUp" },
    },
  ]);
  handlers.get("session_shutdown")();
  assert.equal(detachCount, 2);
});
