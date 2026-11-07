// Guardrail for the known worker polling failure (issue #38), not a security boundary.
// This static scan cannot resolve arbitrary shell expansions, aliases, or external scripts.
const MAX_SECONDS = 10;
const advice = "End your turn, or ask Main with request_input instead of polling.";
const reject = (reason) => ({ reason, message: `Crew shell policy rejected this command: ${reason}. ${advice}` });

// Tokenize shell words while retaining quoted text as arguments. Scan command substitutions
// separately: unlike ordinary quoted text they execute even inside double quotes.
function tokenize(source, nested) {
  const tokens = [];
  let word = "", active = false, quote = "";
  const flush = () => { if (active) tokens.push(word); word = ""; active = false; };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\" && quote !== "'" && i + 1 < source.length) { word += source[++i]; active = true; continue; }
    if (ch === "'" && quote !== '"') { quote = quote ? "" : "'"; active = true; continue; }
    if (ch === '"' && quote !== "'") { quote = quote ? "" : '"'; active = true; continue; }
    if (ch === "$" && source[i + 1] === "(" && quote !== "'") {
      let depth = 1, j = i + 2, q = "";
      for (; j < source.length && depth; j++) {
        const c = source[j];
        if (c === "\\" && q !== "'") { j++; continue; }
        if ((c === "'" || c === '"') && (!q || q === c)) { q = q ? "" : c; continue; }
        if (!q && c === "(") depth++;
        if (!q && c === ")") depth--;
      }
      nested.push(source.slice(i + 2, depth ? j : j - 1));
      word += "$()"; active = true; i = j - 1; continue;
    }
    if (ch === "`" && quote !== "'") {
      const end = source.indexOf("`", i + 1);
      if (end !== -1) { nested.push(source.slice(i + 1, end)); word += "$()"; active = true; i = end; continue; }
    }
    if (!quote && /[\s;&|(){}]/.test(ch)) {
      flush();
      if (ch === "\n" || /[;&|(){}]/.test(ch)) tokens.push(ch);
    } else { word += ch; active = true; }
  }
  flush();
  return tokens;
}

export function evaluateShellCommand(source, depth = 0) {
  if (typeof source !== "string" || !source || depth > 20) return null;
  const nested = [];
  const tokens = tokenize(source, nested);
  for (const script of nested) { const result = evaluateShellCommand(script, depth + 1); if (result) return result; }
  let start = true, loop = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ([";", "&", "|", "\n", "(", ")", "{", "}"].includes(t)) { start = true; continue; }
    if (!start) continue;
    if (t === "while" || t === "until" || t === "for" || t === "select") { loop++; start = true; continue; }
    if (t === "do" || t === "then" || t === "else" || t === "if" || t === "!") { start = true; continue; }
    if (t === "done") { loop = Math.max(0, loop - 1); start = true; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
    const name = t.split("/").pop();
    if (["command", "builtin", "exec", "nohup"].includes(name)) continue;
    if (name === "watch") return reject("watch repeatedly polls");
    if (name === "sleep") {
      if (loop) return reject("sleep in a loop is polling");
      let total = 0, found = false;
      for (let j = i + 1; j < tokens.length && !/^[;&|\n(){}]$/.test(tokens[j]); j++) {
        const arg = tokens[j];
        if (arg === "--") continue;
        const match = /^(\d+(?:\.\d+)?|\.\d+)([smhd]?)$/.exec(arg);
        if (!match) return reject("sleep duration is not statically bounded");
        found = true; total += Number(match[1]) * ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]]);
      }
      if (found && total > MAX_SECONDS) return reject(`sleep exceeds ${MAX_SECONDS} seconds`);
    }
    if (loop && ["tail", "grep", "curl", "wget"].includes(name)) return reject("repeated polling in a loop");
    if (["bash", "sh", "dash", "zsh", "ksh"].includes(name)) {
      for (let j = i + 1; j < tokens.length && !/^[;&|\n(){}]$/.test(tokens[j]); j++) {
        if (/^-.*c/.test(tokens[j]) && tokens[j + 1]) { const result = evaluateShellCommand(tokens[j + 1], depth + 1); if (result) return result; break; }
      }
    }
    if (name === "eval") {
      let j = i + 1;
      while (j < tokens.length && !/^[;&|\n(){}]$/.test(tokens[j])) j++;
      const result = evaluateShellCommand(tokens.slice(i + 1, j).join(" "), depth + 1);
      if (result) return result;
    }
    start = false;
  }
  return null;
}
