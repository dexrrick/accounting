export interface CachedSource {
  canonicalUrl: string;
  retrievedAt: string;
  contentHash: string; // 64-character hex SHA-256
  rawContent?: string;
  normalizedContent?: string;
  httpStatus: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  ttlMs?: number;     // Time-to-live in milliseconds
  expiresAt?: number; // Epoch millisecond timestamp when entry becomes stale
}

/**
 * Controlled cache for externally retrieved documents.
 * Guarantees reproducibility, auditability, offline support, cache freshness semantics,
 * and reduced external traffic through conditional revalidation.
 */
export class SourceCache {
  private cache: Map<string, CachedSource> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 86_400_000) { // Default 24 hours
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Normalizes the lookup URL key (lowercase protocol & domain, trimmed)
   */
  private normalizeKey(url: string): string {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}${u.hash}`;
    } catch {
      return url.trim().toLowerCase();
    }
  }

  /**
   * Retrieves entry from cache regardless of freshness.
   */
  public get(url: string): CachedSource | null {
    const key = this.normalizeKey(url);
    const entry = this.cache.get(key);
    return entry ? { ...entry } : null;
  }

  /**
   * Evaluates if a cached entry exists and is still within its fresh TTL window.
   */
  public isFresh(url: string, nowMs: number = Date.now()): boolean {
    const key = this.normalizeKey(url);
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt === undefined) return true;
    return nowMs < entry.expiresAt;
  }

  /**
   * Retrieves entry only if it is fresh; returns null if missing or expired.
   */
  public getFresh(url: string, nowMs: number = Date.now()): CachedSource | null {
    if (!this.isFresh(url, nowMs)) return null;
    return this.get(url);
  }

  /**
   * Generates conditional revalidation headers (ETag / If-Modified-Since) if available.
   */
  public getConditionalHeaders(url: string): Record<string, string> {
    const entry = this.get(url);
    const headers: Record<string, string> = {};
    if (!entry) return headers;
    if (entry.etag) {
      headers['If-None-Match'] = entry.etag;
    }
    if (entry.lastModified) {
      headers['If-Modified-Since'] = entry.lastModified;
    }
    return headers;
  }

  /**
   * Refreshes the expiration timestamp of an existing cached entry (e.g. on 304 Not Modified).
   */
  public touch(url: string, ttlMs?: number, nowMs: number = Date.now()): boolean {
    const key = this.normalizeKey(url);
    const entry = this.cache.get(key);
    if (!entry) return false;
    const effectiveTtl = ttlMs ?? entry.ttlMs ?? this.defaultTtlMs;
    entry.ttlMs = effectiveTtl;
    entry.expiresAt = nowMs + effectiveTtl;
    return true;
  }

  /**
   * Stores a source entry with explicit or default TTL.
   */
  public set(source: CachedSource, ttlMs?: number, nowMs: number = Date.now()): void {
    const key = this.normalizeKey(source.canonicalUrl);
    const effectiveTtl = ttlMs ?? source.ttlMs ?? this.defaultTtlMs;
    const expiresAt = source.expiresAt ?? (nowMs + effectiveTtl);

    this.cache.set(key, {
      ...source,
      ttlMs: effectiveTtl,
      expiresAt
    });
  }

  /**
   * Prunes all stale entries whose expiration timestamp has passed.
   */
  public pruneExpired(nowMs: number = Date.now()): number {
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== undefined && nowMs >= entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  public invalidate(url: string): void {
    const key = this.normalizeKey(url);
    this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }

  public getAll(): CachedSource[] {
    return Array.from(this.cache.values()).map((s) => ({ ...s }));
  }
}

/**
 * Singleton instance of SourceCache.
 */
export const defaultSourceCache = new SourceCache();
