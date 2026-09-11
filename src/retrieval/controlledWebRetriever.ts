import { defaultExternalSourceValidator, ExternalSourceValidator } from './externalSourceValidator';
import { defaultSourceCache, SourceCache, type CachedSource } from './sourceCache';
import { computeSha256 } from '../standards/sourceVersioning';

export type ControlledFetchStatus =
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'CORS_ERROR'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'UNAUTHORIZED_DOMAIN_ACCESS'
  | 'INVALID_URL'
  | 'INVALID_CONTENT'
  | 'REDIRECT_REJECTED'
  | 'HASH_MISMATCH'
  | 'PROVENANCE_MISMATCH';

export interface ControlledFetchOptions {
  timeoutMs?: number;
  useCache?: boolean;
  ttlMs?: number;
  expectedHash?: string;
  customFetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface ControlledFetchResult {
  status: ControlledFetchStatus;
  httpStatus?: number;
  content?: string;
  contentHash?: string;
  cached?: boolean;
  error?: string;
  retrievedAt: string;
  sourceUrl: string;
  etag?: string;
  lastModified?: string;
}

/**
 * Controlled External Web Retriever.
 * Safely fetches official statutory resources adhering to exact-hostname allowlists,
 * HTTPS on port 443, 3000ms timeouts, and non-throwing failure handling.
 */
export class ControlledWebRetriever {
  private validator: ExternalSourceValidator;
  private cache: SourceCache;

  constructor(validator: ExternalSourceValidator = defaultExternalSourceValidator, cache: SourceCache = defaultSourceCache) {
    this.validator = validator;
    this.cache = cache;
  }

  /**
   * Fetches official source with strict security validation, caching, and timeout controls.
   */
  public async fetchOfficialSource(
    url: string,
    options: ControlledFetchOptions = {}
  ): Promise<ControlledFetchResult> {
    const {
      timeoutMs = 3000,
      useCache = true,
      ttlMs,
      expectedHash,
      customFetch = (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined)
    } = options;

    const retrievedAt = new Date().toISOString();

    // 1. Validate URL security and allowlist
    const secValidation = this.validator.validateUrlSecurity(url);
    if (!secValidation.isValid) {
      return {
        status: secValidation.errorCode === 'UNAUTHORIZED_DOMAIN_ACCESS'
          ? 'UNAUTHORIZED_DOMAIN_ACCESS'
          : 'INVALID_URL',
        error: secValidation.reason,
        retrievedAt,
        sourceUrl: url
      };
    }

    // 2. Check source cache
    let cached: CachedSource | null = null;
    if (useCache) {
      cached = this.cache.get(url);
      if (cached && cached.rawContent) {
        // If expectedHash is specified, verify cached content integrity
        if (expectedHash && cached.contentHash.toLowerCase() !== expectedHash.toLowerCase()) {
          this.cache.invalidate(url);
          cached = null;
        } else if (this.cache.isFresh(url)) {
          return {
            status: 'SUCCESS',
            httpStatus: cached.httpStatus,
            content: cached.rawContent,
            contentHash: cached.contentHash,
            cached: true,
            retrievedAt: cached.retrievedAt,
            sourceUrl: url,
            etag: cached.etag,
            lastModified: cached.lastModified
          };
        }
      }
    }

    // 3. Prepare Fetch with AbortController for strict timeout
    if (!customFetch) {
      return {
        status: 'NETWORK_ERROR',
        error: 'No fetch transport available in current runtime environment',
        retrievedAt,
        sourceUrl: url
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Accept': 'text/plain, application/json, text/html, */*'
      };
      if (useCache && cached) {
        const condHeaders = this.cache.getConditionalHeaders(url);
        Object.assign(headers, condHeaders);
      }

      const response = await customFetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual', // Intercept redirects for security validation
        headers
      });

      clearTimeout(timeoutId);

      // Handle 304 Not Modified
      if (response.status === 304 && cached && cached.rawContent) {
        this.cache.touch(url, ttlMs);
        return {
          status: 'SUCCESS',
          httpStatus: 304,
          content: cached.rawContent,
          contentHash: cached.contentHash,
          cached: true,
          retrievedAt,
          sourceUrl: url,
          etag: cached.etag,
          lastModified: cached.lastModified
        };
      }

      // Handle redirect status codes (301, 302, 303, 307, 308)
      if (response.status >= 300 && response.status < 400) {
        const redirectLocation = response.headers?.get('location');
        if (!redirectLocation) {
          return {
            status: 'REDIRECT_REJECTED',
            httpStatus: response.status,
            error: 'Redirect response missing Location header',
            retrievedAt,
            sourceUrl: url
          };
        }

        let targetUrl: string;
        try {
          targetUrl = new URL(redirectLocation, url).toString();
        } catch {
          return {
            status: 'REDIRECT_REJECTED',
            httpStatus: response.status,
            error: `Invalid redirect location: '${redirectLocation}'`,
            retrievedAt,
            sourceUrl: url
          };
        }

        const redirectValidation = this.validator.validateRedirect(url, targetUrl);
        if (!redirectValidation.isValid) {
          return {
            status: 'REDIRECT_REJECTED',
            httpStatus: response.status,
            error: redirectValidation.reason,
            retrievedAt,
            sourceUrl: url
          };
        }

        // Follow authorized redirect
        return await this.fetchOfficialSource(targetUrl, { ...options, useCache: false });
      }

      if (!response.ok) {
        return {
          status: 'HTTP_ERROR',
          httpStatus: response.status,
          error: `HTTP response error: ${response.status} ${response.statusText}`,
          retrievedAt,
          sourceUrl: url
        };
      }

      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return {
          status: 'INVALID_CONTENT',
          httpStatus: response.status,
          error: 'Received empty response body',
          retrievedAt,
          sourceUrl: url
        };
      }

      const hash = computeSha256(text);

      // Hash mismatch verification
      if (expectedHash && hash.toLowerCase() !== expectedHash.toLowerCase()) {
        return {
          status: 'HASH_MISMATCH',
          httpStatus: response.status,
          content: text,
          contentHash: hash,
          error: `Content hash mismatch: expected '${expectedHash}', got '${hash}'`,
          retrievedAt,
          sourceUrl: url
        };
      }

      const etag = response.headers?.get('etag') || undefined;
      const lastModified = response.headers?.get('last-modified') || undefined;
      const contentType = response.headers?.get('content-type') || undefined;

      // Store into cache
      if (useCache) {
        const defaultUrlTtl = url.includes('frankfurter') ? 3_600_000 : 86_400_000;
        const effectiveTtl = ttlMs ?? defaultUrlTtl;
        const cachedSource: CachedSource = {
          canonicalUrl: url,
          retrievedAt,
          contentHash: hash,
          rawContent: text,
          httpStatus: response.status,
          contentType,
          etag,
          lastModified,
          ttlMs: effectiveTtl
        };
        this.cache.set(cachedSource, effectiveTtl);
      }

      return {
        status: 'SUCCESS',
        httpStatus: response.status,
        content: text,
        contentHash: hash,
        cached: false,
        retrievedAt,
        sourceUrl: url,
        etag,
        lastModified
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError' || controller.signal.aborted) {
        return {
          status: 'TIMEOUT',
          error: `Fetch timed out after ${timeoutMs}ms`,
          retrievedAt,
          sourceUrl: url
        };
      }

      // Check for CORS failure signature in browsers
      const errStr = (err.message || '').toLowerCase();
      if (errStr.includes('failed to fetch') || errStr.includes('cors') || errStr.includes('networkerror')) {
        return {
          status: 'CORS_ERROR',
          error: `Network/CORS error: ${err.message}`,
          retrievedAt,
          sourceUrl: url
        };
      }

      return {
        status: 'NETWORK_ERROR',
        error: `Network error: ${err.message || String(err)}`,
        retrievedAt,
        sourceUrl: url
      };
    }
  }
}

/**
 * Singleton instance of ControlledWebRetriever.
 */
export const defaultControlledWebRetriever = new ControlledWebRetriever();
