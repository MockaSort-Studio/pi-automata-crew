import { ReadonlyProvider } from "@earendil-works/gondolin";
import { constants } from "node:os";

// Same shape as Gondolin 0.14.0 createErrnoError(ERRNO.EROFS, ...): the guest
// file RPC maps the numeric errno, so a bare `code` would surface as EIO.
export function readonlyError(syscall, path) {
  const error = new Error(path ? `EROFS: ${syscall} '${path}'` : `EROFS: ${syscall}`);
  return Object.assign(error, { code: "EROFS", errno: constants.errno.EROFS, syscall }, path ? { path } : {});
}

const READ_FLAGS = new Set(["r", "rs", "sr"]);
const HANDLE_WRITES = new Set(["write", "writeSync", "writeFile", "writeFileSync", "truncate", "truncateSync"]);

// Gondolin 0.14.0's ReadonlyProvider delegates raw read handles whose write and
// truncate methods are not restricted. Never let a raw handle reach the VFS.
function readonlyHandle(handle, path) {
  return new Proxy(handle, {
    get(target, property) {
      if (HANDLE_WRITES.has(property)) {
        const syscall = String(property).replace(/(File)?(Sync)?$/, "");
        if (String(property).endsWith("Sync"))
          return () => {
            throw readonlyError(syscall, path);
          };
        return async () => {
          throw readonlyError(syscall, path);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export class ReadonlySnapshotProvider extends ReadonlyProvider {
  async open(path, flags, mode) {
    if (!READ_FLAGS.has(flags)) throw readonlyError("open", path);
    return readonlyHandle(await super.open(path, flags, mode), path);
  }
  openSync(path, flags, mode) {
    if (!READ_FLAGS.has(flags)) throw readonlyError("open", path);
    return readonlyHandle(super.openSync(path, flags, mode), path);
  }
}
