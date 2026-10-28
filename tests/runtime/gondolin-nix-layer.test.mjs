import { strict as assert } from "node:assert";
import test from "node:test";
import { createFilteredNixStoreProvider, createGondolinNixLayer } from "../../.pi/extensions/hall-crew/env-runtime/lib/gondolin-nix-layer.mjs";

const allowed = "/nix/store/0123456789abcdefghijklmnopqrstuv-gh-2.101.0";
const hidden = "vutsrqponmlkjihgfedcba9876543210-secret-1";

function backend() {
  const calls = [];
  const value = (method) => (...args) => { calls.push([method, ...args]); return method === "readdirSync" ? [allowed.slice(11), hidden] : method === "readlinkSync" || method === "realpathSync" ? args[0] : {}; };
  return {
    calls, supportsSymlinks: true, supportsWatch: false,
    open: value("open"), openSync: value("openSync"), stat: value("stat"), statSync: value("statSync"),
    lstat: value("lstat"), lstatSync: value("lstatSync"), readdirSync: value("readdirSync"),
    readlink: value("readlink"), readlinkSync: value("readlinkSync"), realpath: value("realpath"), realpathSync: value("realpathSync"),
    access: value("access"), accessSync: value("accessSync"),
  };
}

const denied = (fn) => assert.throws(fn, (error) => error?.code === "ENOENT" && error.message === "Nix store entry is unavailable");

test("Gondolin receives one filtered read-only Nix store mount", () => {
  const mounts = createGondolinNixLayer([allowed], { provider: (selected) => ({ selected, readonly: true }) });
  assert.deepEqual(mounts, { "/nix/store": { selected: [allowed], readonly: true } });
});

test("filtered provider hides unrelated entries and rejects traversal", async () => {
  const fake = backend();
  const provider = createFilteredNixStoreProvider([allowed], { backend: fake });
  assert.deepEqual(provider.readdirSync(""), [allowed.slice(11)]);
  for (const operation of [
    () => provider.openSync(`${hidden}/bin/x`, "r"),
    () => provider.statSync(`../${hidden}`),
    () => provider.lstatSync(`${hidden}`),
    () => provider.accessSync(`${hidden}`),
    () => provider.readdirSync(hidden),
  ]) denied(operation);
  await assert.rejects(() => provider.open(`${hidden}/bin/x`, "r"), (error) => error?.code === "ENOENT");
  assert.equal(fake.calls.length, 1, "denied paths must not reach the host backend");
});

test("filtered provider blocks unselected store symlink and realpath targets", () => {
  const fake = backend();
  fake.readlinkSync = () => `/nix/store/${hidden}/bin/x`;
  fake.realpathSync = () => `/nix/store/${hidden}/bin/x`;
  const provider = createFilteredNixStoreProvider([allowed], { backend: fake });
  denied(() => provider.readlinkSync(`${allowed.slice(11)}/bin/x`));
  denied(() => provider.realpathSync(`${allowed.slice(11)}/bin/x`));
});

test("filtered provider rejects writes through its read-only wrapper", () => {
  const provider = createFilteredNixStoreProvider([allowed], { backend: backend() });
  assert.throws(() => provider.openSync(`${allowed.slice(11)}/new`, "w"), /ERRNO_30/);
});

test("Gondolin Nix layer rejects duplicate store paths", () =>
  assert.throws(() => createGondolinNixLayer([allowed, allowed]), /unique Nix store paths/));
