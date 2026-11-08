// Regenerates tests/fixtures/armory-operations.json from a RELEASED Armory suite bundle.
// Usage: node scripts/snapshot-armory-operations.mjs [armory-release-revision]   (needs network)
// Offline: ARMORY_ARTIFACTS_FILE=<downloaded artifacts.json> (the bundle itself is cached and re-verified by hash).
// The bundle is fetched and hash-verified by the same code a launch uses; only operation names and
// their input field names/types/required-ness are recorded, never any behavior or credential.
import { readFileSync, writeFileSync } from "node:fs";
import { resolveArmoryCatalog, pinnedReleaseUrl } from "../extensions/crew/env-runtime/lib/armory-artifacts.mjs";
import { fetchSuiteExtension } from "../extensions/crew/runner/armory-source.mjs";
import { loadSuiteModule } from "../extensions/crew/runner/github-suite.mjs";

const suiteId = "collaboration/pi-github-tools";
const revision = process.argv[2];
const offline = process.env.ARMORY_ARTIFACTS_FILE;
const catalog = await resolveArmoryCatalog({
  ...(revision ? { release: pinnedReleaseUrl(revision) } : {}),
  ...(offline ? { fetchImpl: async () => new Response(readFileSync(offline)) } : {}),
});
const module = await loadSuiteModule(await fetchSuiteExtension({ catalog, suiteId }));
const tools = new Map();
module.activateSuite(
  { registerTool: (tool) => tools.set(tool.name, tool), on() {} },
  { commandTransport: { run: async () => "" }, workspace: { fs: {}, dir: "/", env: {} } },
);
const typeOf = (schema) => schema.type ?? schema.anyOf?.map((part) => part.type).join("|") ?? "unknown";
const operations = Object.fromEntries(
  [...tools]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, tool]) => {
      const schema = JSON.parse(JSON.stringify(tool.parameters));
      const fields = Object.fromEntries(
        Object.entries(schema.properties ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, typeOf(value)]),
      );
      return [name, { fields, required: [...(schema.required ?? [])].sort() }];
    }),
);
const snapshot = {
  suite: suiteId,
  revision: catalog.revision,
  sourceSha256: catalog.sources[suiteId].sha256,
  operations,
};
writeFileSync(
  new URL("../tests/fixtures/armory-operations.json", import.meta.url),
  `${JSON.stringify(snapshot, null, 2)}\n`,
);
console.log(`${Object.keys(operations).length} operations from ${catalog.revision}`);
