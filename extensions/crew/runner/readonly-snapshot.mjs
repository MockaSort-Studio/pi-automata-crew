import { ERRNO, ReadonlyProvider } from "@earendil-works/gondolin";

// The error Gondolin 0.14.0's ReadonlyProvider raises, createErrnoError(ERRNO.EROFS, ...), built directly: the guest
// file RPC maps the numeric errno (EROFS, 30 on Linux and macOS) to "Read-only file system"; a bare `code` surfaced
// as EIO. Gondolin names the code with getSystemErrorName, which only accepts negative libuv values and so always
// throws for this positive errno, leaving its fallback `ERRNO_<n>`; that is the code used here, without the dead try.
const EROFS = ERRNO.EROFS;
const EROFS_CODE = `ERRNO_${EROFS}`;

export function readonlyError(syscall, path) {
  const errno = EROFS;
  const code = EROFS_CODE;
  const error = new Error(path ? `${code}: ${syscall} '${path}'` : `${code}: ${syscall}`);
  return Object.assign(error, { code, errno, syscall }, path ? { path } : {});
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
