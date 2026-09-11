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
}

/**
 * Controlled cache for externally retrieved documents.
 * Guarantees reproducibility, auditability, offline support, and reduced external traffic.
 */
export class SourceCache {
  private cache: Map<string, CachedSource> = new Map();

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

  public get(url: string): CachedSource | null {
    const key = this.normalizeKey(url);
    const entry = this.cache.get(key);
    return entry ? { ...entry } : null;
  }

  public set(source: CachedSource): void {
    const key = this.normalizeKey(source.canonicalUrl);
    this.cache.set(key, { ...source });
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
