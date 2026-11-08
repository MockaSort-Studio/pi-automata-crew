import { MemoryProvider, ReadonlyProvider } from "@earendil-works/gondolin";
import { posix } from "node:path";
import { prepareSources } from "./dependency-bootstrap.mjs";

export const GUEST_SOURCES = "/opt/crew/dependency-sources";
let prepared;

// Shared immutable snapshot, never a host filesystem mount. In particular, no
// archive symlink is created, and the guest only sees bytes authenticated by SRI.
export async function buildDependencyMount({ snapshots, failures }) {
  const memory = new MemoryProvider();
  for (const snapshot of snapshots) {
    const base = `/${snapshot.manifest.name}`;
    for (const [name, bytes] of Object.entries(snapshot.files)) {
      const path = `${base}/${name}`;
      await memory.mkdir(posix.dirname(path), { recursive: true });
      await memory.writeFile(path, bytes);
    }
  }
  await memory.writeFile(
    "/manifest.json",
    JSON.stringify({ packages: snapshots.map((item) => item.manifest), failures }, null, 2),
  );
  return { provider: new ReadonlyProvider(memory), available: snapshots.map((item) => item.manifest.name), failures };
}

export function prepareDependencyMount() {
  prepared ??= prepareSources()
    .then(buildDependencyMount)
    .catch((error) => {
      prepared = undefined;
      throw error;
    });
  return prepared;
}
