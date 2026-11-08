import { ReadonlyProvider } from "@earendil-works/gondolin";

const denied = () => Object.assign(new Error("Read-only dependency snapshot"), { code: "EROFS" });
const writes = new Set(["write", "writeSync", "writeFile", "writeFileSync", "truncate", "truncateSync"]);

// Gondolin 0.14.0's ReadonlyProvider delegates raw read handles whose write and
// truncate methods are not restricted. Never let a raw handle reach the VFS.
function readonlyHandle(handle) {
  return new Proxy(handle, {
    get(target, property) {
      if (writes.has(property)) {
        if (String(property).endsWith("Sync"))
          return () => {
            throw denied();
          };
        return async () => {
          throw denied();
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export class ReadonlySnapshotProvider extends ReadonlyProvider {
  async open(path, flags, mode) {
    if (!["r", "rs", "sr"].includes(flags)) throw denied();
    return readonlyHandle(await super.open(path, flags, mode));
  }
  openSync(path, flags, mode) {
    if (!["r", "rs", "sr"].includes(flags)) throw denied();
    return readonlyHandle(super.openSync(path, flags, mode));
  }
}
