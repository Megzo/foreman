import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

/**
 * The bundle archive format. The PRD recommends tar.gz, but Node ships no tar
 * and a real tar dep buys nothing here — the format is private to the shell and
 * this tool. So a bundle is a gzipped JSON envelope of `{path, data(base64)}`
 * entries, sorted by path so packing is **deterministic** (the bytes we sign are
 * the bytes we ship). zlib gzip with a fixed (zero) mtime keeps it byte-stable.
 */

interface BundleEntry {
  path: string;
  data: string;
}

interface BundleEnvelope {
  schemaVersion: 1;
  entries: BundleEntry[];
}

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...(await walk(full, base)));
    } else if (dirent.isFile()) {
      out.push(relative(base, full));
    }
  }
  return out;
}

/** Packs an app directory tree into a deterministic, signable archive buffer. */
export async function packBundle(appDir: string): Promise<Buffer> {
  const relPaths = (await walk(appDir, appDir)).sort();
  const entries: BundleEntry[] = [];
  for (const rel of relPaths) {
    const data = await readFile(join(appDir, rel));
    // Normalize separators so a bundle packed on Windows unpacks on Linux.
    entries.push({ path: rel.split(sep).join("/"), data: data.toString("base64") });
  }
  const envelope: BundleEnvelope = { schemaVersion: 1, entries };
  // gzipSync on a Buffer emits a header with mtime 0 and no filename, so the
  // bytes are stable for identical input — exactly what signing needs.
  return gzipSync(Buffer.from(JSON.stringify(envelope)));
}

/** Inflates a bundle archive into destDir, recreating the directory tree. */
export async function unpackBundle(archive: Buffer, destDir: string): Promise<void> {
  const envelope = JSON.parse(gunzipSync(archive).toString("utf8")) as BundleEnvelope;
  for (const entry of envelope.entries) {
    const full = join(destDir, ...entry.path.split("/"));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(entry.data, "base64"));
  }
}
