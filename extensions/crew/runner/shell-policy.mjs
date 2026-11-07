// Guardrail for the known worker polling failure (issue #38), not a security boundary.
// This static scan cannot resolve arbitrary shell expansions, aliases, or external scripts.
// Known gaps include dynamic command names (S=sleep; $S 300), Python or Perl
// sleep calls, and read -t timeouts. While/until input loops may be unbounded.
const MAX_SECONDS = 10;
const advice = "End your turn, or ask Main with request_input instead of polling.";
const reject = (reason) => ({ reason, message: `Crew shell policy rejected this command: ${reason}. ${advice}` });

// Tokenize shell words while retaining quoted text as arguments. Scan command substitutions
// separately: unlike ordinary quoted text they execute even inside double quotes.
function tokenize(source) {
  const tokens = [],
    heredocs = [];
  let word = "",
    active = false,
    quote = "",
    redirect = false;
  const flush = () => {
    if (active && !redirect) tokens.push(word);
    if (active) redirect = false;
    word = "";
    active = false;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (!quote && ch === "\n" && heredocs.length) {
      flush();
      tokens.push("\n");
      for (const { delimiter, tabs } of heredocs.splice(0)) {
        let found = false;
        while (i + 1 < source.length) {
          const start = i + 1,
            end = source.indexOf("\n", start);
          const line = source.slice(start, end < 0 ? source.length : end);
          i = end < 0 ? source.length : end;
          if ((tabs ? line.replace(/^\t+/, "") : line) === delimiter) {
            found = true;
            break;
          }
        }
        if (!found) return null;
      }
      continue;
    }
    if (!quote && ch === "<" && source[i + 1] === "<" && source[i + 2] !== "<") {
      const match = /^<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|([^\s;&|<>(){}'"]+))/.exec(source.slice(i));
      if (match) heredocs.push({ delimiter: match[2] || match[3] || match[4], tabs: !!match[1] });
    }
    if (!quote && ch === "#" && !active) {
      while (i < source.length && source[i] !== "\n") i++;
      if (i < source.length) i--;
      continue;
    }
    if (!quote && (ch === "<" || ch === ">" || (ch === "&" && source[i + 1] === ">"))) {
      if (active && /^\d+$/.test(word)) {
        word = "";
        active = false;
      } else flush();
      if (ch === "&") i++;
      if (source[i + 1] === source[i]) i++;
      if (source[i + 1] === "&") i++;
      redirect = true;
      continue;
    }
    if (ch === "\\" && quote !== "'" && i + 1 < source.length) {
      word += source[++i];
      active = true;
      continue;
    }
    if (ch === "'" && quote !== '"') {
      quote = quote ? "" : "'";
      active = true;
      continue;
    }
    if (ch === '"' && quote !== "'") {
      quote = quote ? "" : '"';
      active = true;
      continue;
    }
    if (ch === "$" && source[i + 1] === "(" && quote !== "'") {
      let depth = 1,
        j = i + 2,
        q = "";
      for (; j < source.length && depth; j++) {
        const c = source[j];
        if (c === "\\" && q !== "'") {
          j++;
          continue;
        }
        if ((c === "'" || c === '"') && (!q || q === c)) {
          q = q ? "" : c;
          continue;
        }
        if (!q && c === "(") depth++;
        if (!q && c === ")") depth--;
      }
      tokens.push({ script: source.slice(i + 2, depth ? j : j - 1) });
      word += "$()";
      active = true;
      i = j - 1;
      continue;
    }
    if (ch === "`" && quote !== "'") {
      const end = source.indexOf("`", i + 1);
      if (end !== -1) {
        tokens.push({ script: source.slice(i + 1, end) });
        word += "$()";
        active = true;
        i = end;
        continue;
      }
    }
    if (!quote && /[\s;&|(){}]/.test(ch)) {
      flush();
      if (ch === "\n" || /[;&|(){}]/.test(ch)) tokens.push(ch);
    } else {
      word += ch;
      active = true;
    }
  }
  flush();
  return heredocs.length ? null : tokens;
}

export function evaluateShellCommand(source) {
  return scan(source, 0, [], { total: 0 });
}

function scan(source, depth, inherited, state) {
  if (typeof source !== "string" || !source || depth > 20) return null;
  const tokens = tokenize(source);
  if (!tokens) return reject("unterminated heredoc");
  let start = true;
  const loops = [...inherited];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (typeof t === "object") {
      const result = scan(t.script, depth + 1, loops, state);
      if (result) return result;
      continue;
    }
    if ([";", "&", "|", "\n", "(", ")", "{", "}"].includes(t)) {
      start = true;
      continue;
    }
    if (!start) continue;
    if (t === "while" || t === "until" || t === "for" || t === "select") {
      loops.push({
        kind: t,
        waiting: t === "until" || (t === "while" && ["true", ":"].includes(tokens[i + 1])),
        body: false,
      });
      start = true;
      continue;
    }
    if (t === "do") {
      if (loops.length) loops[loops.length - 1].body = true;
      start = true;
      continue;
    }
    if (t === "then" || t === "else" || t === "if" || t === "!") {
      start = true;
      continue;
    }
    if (t === "done") {
      loops.pop();
      start = true;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
    const name = t.split("/").pop();
    if (["command", "builtin", "exec", "nohup", "env", "nice", "time", "timeout"].includes(name)) {
      while (typeof tokens[i + 1] === "string" && /^-/.test(tokens[i + 1])) {
        const option = tokens[++i];
        if (
          ["-u", "--unset", "-C", "--chdir", "-n", "--adjustment", "-k", "--kill-after", "-s", "--signal"].includes(
            option,
          )
        )
          i++;
      }
      if (name === "timeout" && typeof tokens[i + 1] === "string") i++;
      continue;
    }
    if (name === "watch") return reject("watch repeatedly polls");
    if (name === "sleep") {
      if (loops.some((loop) => loop.kind === "while" || loop.kind === "until"))
        return reject("sleep in a loop is polling");
      let total = 0,
        found = false;
      for (let j = i + 1; j < tokens.length && !/^[;&|\n(){}]$/.test(tokens[j]); j++) {
        const arg = tokens[j];
        if (arg === "--") continue;
        const match = /^(\d+(?:\.\d+)?|\.\d+)([smhd]?)$/.exec(arg);
        if (!match) return reject("sleep duration is not statically bounded");
        found = true;
        total += Number(match[1]) * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
      }
      if (loops.length && total > 2) return reject("sleep in a finite loop exceeds 2 seconds");
      state.total += total;
      if (found && state.total > MAX_SECONDS) return reject(`sleep exceeds ${MAX_SECONDS} seconds`);
    }
    if (name === "tail") {
      for (let j = i + 1; j < tokens.length && !/^[;&|\n(){}]$/.test(tokens[j]); j++) {
        const arg = tokens[j];
        if (arg === "--") break;
        if (typeof arg === "string" && (arg === "--follow" || arg.startsWith("--follow=") || /^-[^-]*[fF]/.test(arg)))
          return reject("tail follow continuously polls a log");
      }
    }
    if (loops.some((loop) => loop.waiting && loop.body) && ["tail", "grep", "curl", "wget"].includes(name))
      return reject("repeated polling in a waiting loop");
    if (["bash", "sh", "dash", "zsh", "ksh"].includes(name)) {
      for (let j = i + 1; j < tokens.length && !/^[;&|\n(){}]$/.test(tokens[j]); j++) {
        if (/^-.*c/.test(tokens[j]) && tokens[j + 1]) {
          const result = scan(tokens[j + 1], depth + 1, loops, state);
          if (result) return result;
          break;
        }
      }
    }
    if (name === "eval") {
      let j = i + 1;
      while (j < tokens.length && !/^[;&|\n(){}]$/.test(tokens[j])) j++;
      const result = scan(tokens.slice(i + 1, j).join(" "), depth + 1, loops, state);
      if (result) return result;
    }
    start = false;
  }
  return null;
}
