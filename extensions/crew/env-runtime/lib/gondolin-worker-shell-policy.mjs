// Policy guard for the worker bash route (extensions/crew/env-runtime/lib/gondolin-worker-shell.mjs).
//
// Context (issue #38): a developer worker ran `sleep 280; tail …` to poll a log file inside a
// single bounded bash call. The native Bash tool timeout bounded the call, but the full timeout
// window was consumed sleeping instead of doing work, which wastes the bounded allotment and
// hides what the command is actually waiting on. Prompt-only guidance did not stop it, so this
// module enforces rejection at the operations layer, before any guest process is spawned.
//
// Detection is deliberately narrow: it targets `sleep`/`watch` invoked as a *command* (at the
// start of the script or right after a shell separator such as `;`, `&&`, `||`, `|`, `(`, `{`,
// or a newline), plus `while`/`until` polling loops whose body invokes `sleep`. Text that merely
// contains the word "sleep" (inside quotes, filenames, commit messages, etc.) is left alone, and
// short bounded sleeps used for ordinary retry backoff are allowed.

/** Reason codes returned by `evaluateShellCommand`. Stable for tests and callers. */
export const SHELL_POLICY_REASON_CODES = Object.freeze({
  LONG_SLEEP: "long-sleep",
  INDETERMINATE_SLEEP: "indeterminate-sleep",
  SLEEP_POLL_LOOP: "sleep-poll-loop",
  WATCH_COMMAND: "watch-command",
});

/** Sleeps at or below this many seconds are treated as ordinary bounded backoff, not polling. */
export const MAX_ALLOWED_SLEEP_SECONDS = 10;

const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86400 };

/** Error thrown when a command is rejected by shell policy. Carries a stable `reasonCode`. */
export class ShellPolicyRejection extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = "ShellPolicyRejection";
    this.reasonCode = reasonCode;
  }
}

// A command-start position: the beginning of the string, or right after a shell separator.
// Matching on these positions (rather than a bare `\bsleep\b`) is what lets plain text or
// filenames that happen to contain "sleep" pass through untouched.
const COMMAND_START = String.raw`(?:^|[;&|(\{\n]|&&|\|\|)\s*`;

const SLEEP_COMMAND_RE = new RegExp(`${COMMAND_START}sleep\\s+([^\\s;&|)\\n]+)`, "g");
const WATCH_COMMAND_RE = new RegExp(`${COMMAND_START}watch(?:\\s|$)`);
const SLEEP_POLL_LOOP_RE = /\b(while|until)\b[\s\S]*?\bdo\b[\s\S]*?\bsleep\b[\s\S]*?\bdone\b/;

/**
 * Blank out the contents of single- and double-quoted segments, preserving length and any
 * unquoted structural characters (so separator-relative matching above still lines up).
 * This is what keeps `echo "please sleep well"` or `touch "sleep-notes.txt"` from matching.
 */
function blankQuotedSegments(command) {
  let result = "";
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      result += ch === quote ? ch : " ";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      result += ch;
      continue;
    }
    result += ch;
  }
  return result;
}

function parseSleepDurationSeconds(token) {
  const match = /^([0-9]*\.?[0-9]+)([smhd]?)$/.exec(token);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2] || "s";
  return amount * SECONDS_PER_UNIT[unit];
}

/**
 * Evaluate a shell command string against the polling/sleep policy.
 * Returns `null` when the command is allowed, or `{ reasonCode, message }` when it must be
 * rejected.
 */
export function evaluateShellCommand(command) {
  if (typeof command !== "string" || command.length === 0) return null;
  const scrubbed = blankQuotedSegments(command);

  if (SLEEP_POLL_LOOP_RE.test(scrubbed)) {
    return {
      reasonCode: SHELL_POLICY_REASON_CODES.SLEEP_POLL_LOOP,
      message:
        "Rejected: a while/until loop that calls `sleep` is a polling loop. Worker bash calls must be " +
        "bounded, single-pass commands; do not poll inside the call. Re-run the command once when the " +
        "condition is actually ready, or ask Main/lead for a longer-running watch mechanism.",
    };
  }

  if (WATCH_COMMAND_RE.test(scrubbed)) {
    return {
      reasonCode: SHELL_POLICY_REASON_CODES.WATCH_COMMAND,
      message:
        "Rejected: `watch` repeatedly polls a command and is not a bounded, single-pass operation. " +
        "Run the underlying command once instead.",
    };
  }

  SLEEP_COMMAND_RE.lastIndex = 0;
  let match;
  while ((match = SLEEP_COMMAND_RE.exec(scrubbed))) {
    const token = match[1];
    const seconds = parseSleepDurationSeconds(token);
    if (seconds === null) {
      return {
        reasonCode: SHELL_POLICY_REASON_CODES.INDETERMINATE_SLEEP,
        message:
          `Rejected: \`sleep ${token}\` has a duration that cannot be statically bounded. Use a fixed, ` +
          `short sleep (<= ${MAX_ALLOWED_SLEEP_SECONDS}s) for retry backoff, or avoid sleeping and poll ` +
          "in a separate, later call instead.",
      };
    }
    if (seconds > MAX_ALLOWED_SLEEP_SECONDS) {
      return {
        reasonCode: SHELL_POLICY_REASON_CODES.LONG_SLEEP,
        message:
          `Rejected: \`sleep ${token}\` (${seconds}s) exceeds the ${MAX_ALLOWED_SLEEP_SECONDS}s limit for ` +
          "worker bash calls. Long sleeps consume the whole bounded call waiting instead of doing work " +
          "(see issue #38). Do not use sleep to poll for a log line or external state; run the check once " +
          "and return, or ask Main/lead how to wait.",
      };
    }
  }

  return null;
}

/** Throws `ShellPolicyRejection` when `command` violates the polling/sleep policy. */
export function assertShellCommandAllowed(command) {
  const rejection = evaluateShellCommand(command);
  if (rejection) throw new ShellPolicyRejection(rejection.reasonCode, rejection.message);
}
