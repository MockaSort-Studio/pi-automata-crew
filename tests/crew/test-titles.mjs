// Lists the titles every given test file registers, without running any test body or hook.
// Usage: node tests/crew/test-titles.mjs <out.json> <file>... ; writes {"titles":[...],"unloadable":[...]} to <out.json>
// (a file, not stdout: a piped stdout is cut at the 64 KiB pipe buffer on some platforms).
// `node:test` is replaced, for this process only, by a recorder: test/it/suite titles are recorded and describe
// bodies are called to register their children; nothing else executes. Subtests created inside a test body are
// not visible here (no body runs); tests/crew/ci-backend-policy.test.mjs also scans the sources for them.
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

const RECORDER = `
const titles = (globalThis.__crewTestTitles ??= []);
const nameOf = (name) => (typeof name === "function" ? name.name : String(name ?? ""));
const callbackOf = (args) => args.find((arg) => typeof arg === "function");
const record = (name) => titles.push(nameOf(name));
const recordTest = (name) => record(name);
const recordSuite = (name, ...rest) => {
  record(name);
  const body = callbackOf([name, ...rest].slice(typeof name === "function" ? 0 : 1));
  if (body) body({});
};
const noop = () => {};
const variants = (fn) => Object.assign(fn, { skip: fn, todo: fn, only: fn });
export const test = variants((...args) => recordTest(...args));
export const it = test;
export const describe = variants((...args) => recordSuite(...args));
export const suite = describe;
export const before = noop, after = noop, beforeEach = noop, afterEach = noop;
export const mock = new Proxy({}, { get: () => noop });
export const run = noop;
Object.assign(test, { test, it, describe, suite, before, after, beforeEach, afterEach, mock, run });
export default test;
`;
const HOOKS = `
const recorder = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(RECORDER)}`)};
export async function resolve(specifier, context, next) {
  if (specifier === "node:test") return { url: recorder, shortCircuit: true };
  return next(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
const unloadable = [];
const [outFile, ...testFiles] = process.argv.slice(2);
for (const file of testFiles) {
  try {
    await import(pathToFileURL(resolvePath(file)).href);
  } catch (error) {
    unloadable.push({ file, error: String(error?.message ?? error).split("\n")[0] });
  }
}
writeFileSync(outFile, JSON.stringify({ titles: globalThis.__crewTestTitles ?? [], unloadable }));
process.exit(0);
