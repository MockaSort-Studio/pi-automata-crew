import { get } from "node:https";
import { DEPENDENCY_PINS } from "./dependency-pins.mjs";
import { extractVerifiedPackage } from "./dependency-source.mjs";

const MAX_DOWNLOAD = 32 * 1024 * 1024;

// Fixed origin and paths derived only from the reviewed pins. No redirects,
// credentials, npm configuration, proxy settings, or host package paths.
export function downloadArtifact(pin, { get: requestGet = get, deadlineMs = 10000 } = {}) {
  if (!DEPENDENCY_PINS.some((p) => p.name === pin.name && p.version === pin.version && p.integrity === pin.integrity))
    return Promise.reject(new Error("Unknown dependency pin"));
  const base = pin.name.split("/").at(-1);
  const path = `/${pin.name}/-/${base}-${pin.version}.tgz`;
  return new Promise((resolve, reject) => {
    let settled = false,
      request;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(bytes);
    };
    const timer = setTimeout(() => {
      const error = new Error("Registry artifact deadline exceeded");
      finish(error);
      request?.destroy(error);
    }, deadlineMs);
    try {
      request = requestGet(
        { hostname: "registry.npmjs.org", path, headers: { accept: "application/octet-stream" }, agent: false },
        (response) => {
          if (response.statusCode !== 200) {
            response.destroy();
            request.destroy();
            finish(new Error("Registry artifact unavailable"));
            return;
          }
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (settled) return;
            if (size > MAX_DOWNLOAD) {
              const error = new Error("Registry artifact exceeds bounds");
              finish(error);
              request.destroy(error);
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => finish(null, Buffer.concat(chunks)));
          response.on("error", (error) => finish(error));
          response.on("aborted", () => finish(new Error("Registry response aborted")));
        },
      );
      request.on("error", (error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

export function createSourceCache(pins, prepare) {
  const verified = new Map();
  let preparing;
  return async () => {
    if (!preparing) {
      const missing = pins.filter((pin) => !verified.has(pin.name));
      if (!missing.length) return { snapshots: [...verified.values()], failures: [] };
      preparing = Promise.resolve()
        .then(() => prepare(missing))
        .then((result) => {
          for (const snapshot of result.snapshots) verified.set(snapshot.manifest.name, snapshot);
          return result.failures;
        })
        .finally(() => {
          preparing = undefined;
        });
    }
    const failures = await preparing;
    return { snapshots: [...verified.values()], failures };
  };
}

export async function prepareSources(pins = DEPENDENCY_PINS, download = downloadArtifact) {
  const snapshots = [],
    failures = [];
  await Promise.all(
    pins.map(async (pin) => {
      try {
        const snapshot = extractVerifiedPackage(await download(pin), pin);
        const metadata = JSON.parse(snapshot.files["package.json"].toString("utf8"));
        if (metadata.name !== pin.name || metadata.version !== pin.version)
          throw new Error("package metadata mismatch");
        snapshots.push(snapshot);
      } catch (error) {
        const kind = /integrity/i.test(error?.message ?? "")
          ? "integrity verification failed"
          : /metadata mismatch/.test(error?.message ?? "")
            ? "package version mismatch"
            : /archive/i.test(error?.message ?? "")
              ? "invalid archive"
              : "verified source unavailable";
        failures.push(`${pin.name}@${pin.version}: ${kind}`);
      }
    }),
  );
  return { snapshots, failures };
}
