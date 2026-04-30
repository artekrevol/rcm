import { DocumentManifest, FetchResult } from "./types";
import fs from "fs";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "scrapers");
const MANIFEST_FILE = path.join(CACHE_DIR, "uhc-manifest.json");
const SAMPLE_FETCH_FILE = path.join(CACHE_DIR, "uhc-sample-fetch.json");

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export interface UhcFallbackCache {
  manifest: DocumentManifest[];
  sampleFetch?: {
    url: string;
    mimetype: string;
    final_url: string;
    content_hash: string;
    fetched_at: string;
    contentBase64: string;
  };
  savedAt: string;
}

export function saveManifestCache(manifest: DocumentManifest[]): void {
  try {
    ensureDir();
    const cache: Partial<UhcFallbackCache> = { manifest, savedAt: new Date().toISOString() };
    // Preserve existing sampleFetch if present
    if (fs.existsSync(MANIFEST_FILE)) {
      const existing: UhcFallbackCache = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
      if (existing.sampleFetch) cache.sampleFetch = existing.sampleFetch;
    }
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn("[uhc-fallback-cache] Failed to save manifest:", (e as Error).message);
  }
}

export function saveSampleFetch(url: string, result: FetchResult): void {
  try {
    ensureDir();
    const entry = {
      url,
      mimetype: result.mimetype,
      final_url: result.final_url,
      content_hash: result.content_hash,
      fetched_at: result.fetched_at.toISOString(),
      contentBase64: result.content.toString("base64"),
    };
    fs.writeFileSync(SAMPLE_FETCH_FILE, JSON.stringify(entry, null, 2));
    // Also update manifest file's sampleFetch field
    if (fs.existsSync(MANIFEST_FILE)) {
      const existing: UhcFallbackCache = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
      existing.sampleFetch = entry;
      fs.writeFileSync(MANIFEST_FILE, JSON.stringify(existing, null, 2));
    }
  } catch (e) {
    console.warn("[uhc-fallback-cache] Failed to save sample fetch:", (e as Error).message);
  }
}

export function loadManifestCache(): DocumentManifest[] | null {
  try {
    if (!fs.existsSync(MANIFEST_FILE)) return null;
    const cache: UhcFallbackCache = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
    if (!cache.manifest?.length) return null;
    // Restore Date objects
    return cache.manifest.map(m => ({
      ...m,
      discovered_at: new Date(m.discovered_at),
      last_modified: m.last_modified ? new Date(m.last_modified) : undefined,
    }));
  } catch {
    return null;
  }
}

export function loadSampleFetch(url: string): FetchResult | null {
  try {
    const cache: UhcFallbackCache = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
    const entry = cache.sampleFetch;
    if (!entry || entry.url !== url) return null;
    return {
      content: Buffer.from(entry.contentBase64, "base64"),
      mimetype: entry.mimetype,
      final_url: entry.final_url,
      content_hash: entry.content_hash,
      fetched_at: new Date(entry.fetched_at),
    };
  } catch {
    return null;
  }
}

export function hasCachedManifest(): boolean {
  return fs.existsSync(MANIFEST_FILE);
}
