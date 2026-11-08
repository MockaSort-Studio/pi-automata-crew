import { get } from "node:https";
import { DEPENDENCY_PINS } from "./dependency-pins.mjs";
import { extractVerifiedPackage } from "./dependency-source.mjs";

const MAX_DOWNLOAD = 32 * 1024 * 1024;

// Fixed origin and paths derived only from the reviewed pins. No redirects,
// credentials, npm configuration, proxy settings, or host package paths.
export function downloadArtifact(pin) {
  if (!DEPENDENCY_PINS.some((p) => p.name === pin.name && p.version === pin.version && p.integrity === pin.integrity))
    return Promise.reject(new Error("Unknown dependency pin"));
  const base = pin.name.split("/").at(-1);
  const path = `/${pin.name}/-/${base}-${pin.version}.tgz`;
  return new Promise((resolve, reject) => {
    const request = get({ hostname: "registry.npmjs.org", path, headers: { accept: "application/octet-stream" }, agent: false, timeout: 10000 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Registry artifact unavailable")); return; }
      const chunks = []; let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_DOWNLOAD) { request.destroy(new Error("Registry artifact exceeds bounds")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Registry request timed out")));
    request.on("error", reject);
  });
}

export async function prepareSources(pins = DEPENDENCY_PINS, download = downloadArtifact) {
  const snapshots = [], failures = [];
  await Promise.all(pins.map(async (pin) => {
    try {
      const snapshot = extractVerifiedPackage(await download(pin), pin);
      const metadata = JSON.parse(snapshot.files["package.json"].toString("utf8"));
      if (metadata.name !== pin.name || metadata.version !== pin.version) throw new Error("package metadata mismatch");
      snapshots.push(snapshot);
    } catch { failures.push(`${pin.name}@${pin.version}: verified source unavailable`); }
  }));
  return { snapshots, failures };
}
