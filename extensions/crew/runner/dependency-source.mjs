import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";

const BLOCK = 512;
const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_UNPACKED = 128 * 1024 * 1024;
const MAX_FILES = 12000;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const field = (bytes) => bytes.toString("utf8").replace(/\0.*$/, "");
const octal = (bytes) => {
  const value = field(bytes).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("Invalid dependency archive numeric field");
  return parseInt(value, 8);
};

// No archive parsing, decompression, or extraction happens before SRI verification.
export function extractVerifiedPackage(bytes, pin) {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(pin.integrity ?? "");
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_ARCHIVE || !match)
    throw new Error(`Invalid dependency integrity: ${pin.name}`);
  const expected = Buffer.from(match[1], "base64");
  if (expected.length !== 64 || expected.toString("base64") !== match[1] || !timingSafeEqual(expected, createHash("sha512").update(bytes).digest()))
    throw new Error(`Dependency integrity mismatch: ${pin.name}`);
  let tar;
  try { tar = gunzipSync(bytes, { maxOutputLength: MAX_UNPACKED }); }
  catch { throw new Error(`Invalid dependency archive: ${pin.name}`); }
  const files = Object.create(null);
  let ended = false, count = 0;
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((v) => v === 0)) {
      if (offset + 2 * BLOCK > tar.length || !tar.subarray(offset).every((v) => v === 0)) throw new Error("Invalid dependency archive terminator");
      ended = true; break;
    }
    const checksum = octal(header.subarray(148, 156));
    let actual = 0;
    for (let i = 0; i < BLOCK; i++) actual += i >= 148 && i < 156 ? 32 : header[i];
    if (actual !== checksum) throw new Error("Invalid dependency archive checksum");
    const name = field(header.subarray(0, 100));
    const prefix = field(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const type = header[156];
    const size = octal(header.subarray(124, 136));
    if (!path.startsWith("package/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "." || part.startsWith(".")) || ![0, 48, 53].includes(type) || (type === 53 && size))
      throw new Error("Unsafe dependency archive entry");
    const relative = path.slice(8).replace(/\/$/, "");
    offset += BLOCK;
    if (offset + size > tar.length || ++count > MAX_FILES) throw new Error("Dependency archive exceeds bounds");
    if (type !== 53 && relative) {
      if (Object.hasOwn(files, relative)) throw new Error("Duplicate dependency archive entry");
      files[relative] = Buffer.from(tar.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  if (!ended) throw new Error("Invalid dependency archive terminator");
  return { files, manifest: { name: pin.name, version: pin.version, integrity: pin.integrity, files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, sha256(content)])) } };
}
