import { MemoryProvider } from "@earendil-works/gondolin";

// Gondolin's MemoryProvider gives every open handle its own copy of the file and publishes that
// copy on each write. The guest's O_TRUNC reaches the host as a truncate through a second handle,
// so a writer that opened first republishes the old length: a shorter rewrite keeps the stale
// tail (Node writeFile in the guest, Git's index). Truncating one handle here truncates every
// open handle on the same path, so the writer's copy matches the truncated file.
export class WorkspaceProvider extends MemoryProvider {
  #open = new Map();
  #tracked = new WeakSet();

  // MemoryProvider's async open delegates to openSync, so a handle can arrive here already tracked.
  #track(path, handle) {
    if (this.#tracked.has(handle)) return handle;
    const handles = this.#open.get(path) ?? new Set();
    this.#open.set(path, handles);
    const siblings = () => [...handles].filter((other) => other !== wrapped);
    const release = () => {
      handles.delete(wrapped);
      if (!handles.size) this.#open.delete(path);
    };
    const wrapped = new Proxy(handle, {
      get: (target, key) => {
        if (key === "truncate")
          return async (size = 0) => {
            await target.truncate(size);
            for (const other of siblings()) await other.inner.truncate(size);
          };
        if (key === "truncateSync")
          return (size = 0) => {
            target.truncateSync(size);
            for (const other of siblings()) other.inner.truncateSync(size);
          };
        if (key === "close")
          return async () => {
            release();
            return target.close();
          };
        if (key === "closeSync")
          return () => {
            release();
            return target.closeSync();
          };
        if (key === "inner") return target;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    handles.add(wrapped);
    this.#tracked.add(wrapped);
    return wrapped;
  }

  async open(path, flags, mode) {
    return this.#track(path, await super.open(path, flags, mode));
  }

  openSync(path, flags, mode) {
    return this.#track(path, super.openSync(path, flags, mode));
  }
}
