import { MemoryProvider } from "@earendil-works/gondolin";
import { ReadonlySnapshotProvider } from "./readonly-snapshot.mjs";
import { posix } from "node:path";
import { createSourceCache, prepareSources } from "./dependency-bootstrap.mjs";
import { DEPENDENCY_PINS } from "./dependency-pins.mjs";

export const GUEST_SOURCES = "/opt/crew/dependency-sources";
export const prepareDependencySources = createSourceCache(DEPENDENCY_PINS, prepareSources);

// A read-only, in-memory copy of the verified sources, never a host filesystem mount. In particular, no archive
// symlink is created, and the guest only sees bytes authenticated by SRI. The verified bytes are downloaded once per
// host process (prepareDependencySources caches them), but each call builds its own provider: every environment
// holds a separate copy (about 37 MB on disk for the current pins) until it is disposed. Sharing one provider across
// members is deliberately avoided, so no member's mount can alias another's.
export async function buildDependencyMount({ snapshots, failures }) {
  const memory = new MemoryProvider();
  for (const snapshot of snapshots) {
    const base = `/${snapshot.manifest.name}`;
    for (const [name, bytes] of Object.entries(snapshot.files)) {
      const path = `${base}/${name}`;
      await memory.mkdir(posix.dirname(path), { recursive: true });
      await memory.writeFile(path, Buffer.from(bytes));
    }
  }
  await memory.writeFile(
    "/manifest.json",
    JSON.stringify({ packages: snapshots.map((item) => item.manifest), failures }, null, 2),
  );
  return {
    provider: new ReadonlySnapshotProvider(memory),
    available: snapshots.map((item) => item.manifest.name),
    failures,
  };
}

export async function prepareDependencyMount() {
  return buildDependencyMount(await prepareDependencySources());
}
