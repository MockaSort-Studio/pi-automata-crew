import { ReadonlyProvider, RealFSProvider, VirtualProviderClass } from "@earendil-works/gondolin";
import { posix } from "node:path";

const STORE_PATH = /^\/nix\/store\/([a-z0-9]{32}-[^/]+)$/;
const missing = () => Object.assign(new Error("Nix store entry is unavailable"), { code: "ENOENT" });

class FilteredStoreProvider extends VirtualProviderClass {
  constructor(paths, backend = new RealFSProvider("/nix/store")) {
    super();
    this.backend = backend;
    this.allowed = new Set(paths.map((path) => STORE_PATH.exec(path)[1]));
  }
  get supportsSymlinks() { return this.backend.supportsSymlinks; }
  get supportsWatch() { return false; }
  entry(path) {
    if (typeof path !== "string" || path.split("/").includes("..")) throw missing();
    const normalized = posix.normalize(`/${path}`).slice(1);
    if (!normalized || normalized === ".") return normalized;
    if (!this.allowed.has(normalized.split("/")[0])) throw missing();
    return normalized;
  }
  target(value) {
    if (typeof value === "string" && value.startsWith("/nix/store/") && !this.allowed.has(value.slice("/nix/store/".length).split("/")[0]))
      throw missing();
    return value;
  }
  async open(path, ...args) { return this.backend.open(this.entry(path), ...args); }
  openSync(path, ...args) { return this.backend.openSync(this.entry(path), ...args); }
  async stat(path, ...args) { return this.backend.stat(this.entry(path), ...args); }
  statSync(path, ...args) { return this.backend.statSync(this.entry(path), ...args); }
  async lstat(path, ...args) { return this.backend.lstat(this.entry(path), ...args); }
  lstatSync(path, ...args) { return this.backend.lstatSync(this.entry(path), ...args); }
  async readdir(path, ...args) { return this.readdirSync(path, ...args); }
  readdirSync(path, ...args) {
    const entry = this.entry(path);
    const entries = this.backend.readdirSync(entry, ...args);
    return entry ? entries : entries.filter((item) => this.allowed.has(typeof item === "string" ? item : item.name));
  }
  async readlink(path, ...args) { return this.target(await this.backend.readlink(this.entry(path), ...args)); }
  readlinkSync(path, ...args) { return this.target(this.backend.readlinkSync(this.entry(path), ...args)); }
  async realpath(path, ...args) { return this.target(await this.backend.realpath(this.entry(path), ...args)); }
  realpathSync(path, ...args) { return this.target(this.backend.realpathSync(this.entry(path), ...args)); }
  async access(path, ...args) { return this.backend.access(this.entry(path), ...args); }
  accessSync(path, ...args) { return this.backend.accessSync(this.entry(path), ...args); }
}

const validatePaths = (paths) => {
  if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length || !paths.every((path) => STORE_PATH.test(path)))
    throw new Error("Gondolin Nix layer requires unique Nix store paths");
  return paths;
};

export function createFilteredNixStoreProvider(paths, { backend } = {}) {
  return new ReadonlyProvider(new FilteredStoreProvider(validatePaths(paths), backend));
}

// One filtered mount avoids Gondolin's many-sibling-mount deadlock while
// exposing only the selected immutable closure entries to the guest.
export function createGondolinNixLayer(paths, { provider = (selected) => createFilteredNixStoreProvider(selected) } = {}) {
  return { "/nix/store": provider(validatePaths(paths)) };
}
